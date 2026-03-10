// src/api/services/tutorFinancialScore.service.js
const Tutor = require('../models/tutor.model');
const Invoice = require('../models/invoice.model');

class TutorFinancialScoreService {
    buildDefaultFinancialScore() {
        return {
            value: 600,
            classification: 'moderate',
            status: 'not_calculated',
            confidenceLevel: 'low',
            summary: {
                totalInvoices: 0,
                paidOnTime: 0,
                paidLate: 0,
                unpaidOverdue: 0,
                consecutiveOnTimePayments: 0,
                consecutiveLatePayments: 0,
                averageDelayDays: 0,
                worstDelayDays: 0,
                totalOverdueAmount: 0,
                lastPaymentAt: null,
                lastCalculatedAt: null
            }
        };
    }

    getClassificationByValue(value) {
        const score = Number(value || 0);

        if (score >= 800) return 'excellent';
        if (score >= 650) return 'good';
        if (score >= 500) return 'moderate';
        if (score >= 350) return 'risk';
        return 'high_risk';
    }

    getConfidenceLevel(totalInvoices) {
        if (totalInvoices >= 6) return 'high';
        if (totalInvoices >= 3) return 'medium';
        return 'low';
    }

    clampScore(value) {
        const numericValue = Number(value || 0);
        if (Number.isNaN(numericValue)) return 600;
        return Math.max(0, Math.min(1000, numericValue));
    }

    normalizeScorePayload(existingScore = {}, incomingScore = {}) {
        const defaultScore = this.buildDefaultFinancialScore();

        const merged = {
            ...defaultScore,
            ...(existingScore || {}),
            ...(incomingScore || {}),
            summary: {
                ...defaultScore.summary,
                ...((existingScore && existingScore.summary) || {}),
                ...((incomingScore && incomingScore.summary) || {})
            }
        };

        merged.value = this.clampScore(merged.value);

        if (!incomingScore.classification) {
            merged.classification = this.getClassificationByValue(merged.value);
        }

        if (!merged.summary.lastCalculatedAt) {
            merged.summary.lastCalculatedAt = new Date();
        }

        return merged;
    }

    tutorNeedsFinancialScoreBackfill(tutor) {
        return !tutor.financialScore || typeof tutor.financialScore.value !== 'number';
    }

    _toDateOrNull(value) {
        if (!value) return null;
        const d = new Date(value);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    _endOfDay(date) {
        const d = new Date(date);
        d.setHours(23, 59, 59, 999);
        return d;
    }

    _startOfDay(date) {
        const d = new Date(date);
        d.setHours(0, 0, 0, 0);
        return d;
    }

    _diffDays(dateA, dateB) {
        const a = this._startOfDay(dateA);
        const b = this._startOfDay(dateB);
        return Math.max(0, Math.round((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24)));
    }

    async calculateTutorScore(tutorId, schoolId) {
        const tutor = await Tutor.findOne({ _id: tutorId, school_id: schoolId });
        if (!tutor) {
            throw new Error('Tutor não encontrado ou não pertence a esta escola.');
        }

        const now = new Date();

        const invoices = await Invoice.find({
            tutor: tutorId,
            school_id: schoolId,
            dueDate: { $lte: now },
            status: { $ne: 'canceled' }
        })
            .sort({ dueDate: 1, createdAt: 1 })
            .lean();

        if (!invoices.length) {
            const defaultScore = this.buildDefaultFinancialScore();
            defaultScore.summary.lastCalculatedAt = new Date();

            tutor.financialScore = defaultScore;
            await tutor.save();

            return tutor.financialScore;
        }

        let score = 600;

        let paidOnTime = 0;
        let paidLate = 0;
        let unpaidOverdue = 0;
        let totalOverdueAmount = 0;
        let totalDelayDays = 0;
        let delayedInvoicesCount = 0;
        let worstDelayDays = 0;
        let lastPaymentAt = null;

        const orderedForStreak = [...invoices].sort((a, b) => {
            return new Date(b.dueDate).getTime() - new Date(a.dueDate).getTime();
        });

        let consecutiveOnTimePayments = 0;
        let consecutiveLatePayments = 0;

        for (const invoice of invoices) {
            const dueDate = this._toDateOrNull(invoice.dueDate);
            const paidAt = this._toDateOrNull(invoice.paidAt);

            if (!dueDate) continue;

            const dueEnd = this._endOfDay(dueDate);

            if (invoice.status === 'paid') {
                if (paidAt) {
                    if (paidAt.getTime() <= dueEnd.getTime()) {
                        paidOnTime++;
                        score += 8;
                    } else {
                        paidLate++;
                        const delayDays = this._diffDays(paidAt, dueDate);
                        totalDelayDays += delayDays;
                        delayedInvoicesCount++;
                        worstDelayDays = Math.max(worstDelayDays, delayDays);

                        if (delayDays <= 3) score -= 10;
                        else if (delayDays <= 10) score -= 20;
                        else if (delayDays <= 30) score -= 35;
                        else score -= 60;
                    }

                    if (!lastPaymentAt || paidAt.getTime() > lastPaymentAt.getTime()) {
                        lastPaymentAt = paidAt;
                    }
                } else {
                    // Pago sem paidAt confiável:
                    // conta como pago em dia para não penalizar artificialmente por falha histórica de sincronização.
                    paidOnTime++;
                    score += 6;
                }
            } else {
                const overdueDays = this._diffDays(now, dueDate);
                unpaidOverdue++;
                totalOverdueAmount += Number(invoice.value || 0);
                delayedInvoicesCount++;
                totalDelayDays += overdueDays;
                worstDelayDays = Math.max(worstDelayDays, overdueDays);

                if (overdueDays <= 3) score -= 25;
                else if (overdueDays <= 10) score -= 45;
                else if (overdueDays <= 30) score -= 80;
                else score -= 120;
            }
        }

        for (const invoice of orderedForStreak) {
            const dueDate = this._toDateOrNull(invoice.dueDate);
            const paidAt = this._toDateOrNull(invoice.paidAt);

            if (!dueDate) continue;

            const dueEnd = this._endOfDay(dueDate);

            let isOnTime = false;
            let isLate = false;

            if (invoice.status === 'paid') {
                if (!paidAt || paidAt.getTime() <= dueEnd.getTime()) {
                    isOnTime = true;
                } else {
                    isLate = true;
                }
            } else {
                isLate = true;
            }

            if (isOnTime && consecutiveLatePayments === 0) {
                consecutiveOnTimePayments++;
            } else if (isLate && consecutiveOnTimePayments === 0) {
                consecutiveLatePayments++;
            } else {
                break;
            }
        }

        if (consecutiveOnTimePayments >= 3) score += 20;
        if (consecutiveOnTimePayments >= 6) score += 40;

        const averageDelayDays = delayedInvoicesCount > 0
            ? Number((totalDelayDays / delayedInvoicesCount).toFixed(2))
            : 0;

        const totalInvoices = invoices.length;
        const confidenceLevel = this.getConfidenceLevel(totalInvoices);

        let status = 'calculated';
        if (totalInvoices === 0) {
            status = 'not_calculated';
        } else if (totalInvoices < 3) {
            status = 'insufficient_history';
        }

        score = this.clampScore(score);

        const calculatedScore = {
            value: score,
            classification: this.getClassificationByValue(score),
            status,
            confidenceLevel,
            summary: {
                totalInvoices,
                paidOnTime,
                paidLate,
                unpaidOverdue,
                consecutiveOnTimePayments,
                consecutiveLatePayments,
                averageDelayDays,
                worstDelayDays,
                totalOverdueAmount,
                lastPaymentAt: lastPaymentAt || null,
                lastCalculatedAt: new Date()
            }
        };

        tutor.financialScore = calculatedScore;
        await tutor.save();

        return calculatedScore;
    }

    async recalculateTutorsByIds(tutorIds = [], schoolId) {
        const uniqueTutorIds = [...new Set(
            tutorIds
                .filter(Boolean)
                .map((id) => String(id))
        )];

        if (!uniqueTutorIds.length) {
            return { recalculated: 0 };
        }

        for (const tutorId of uniqueTutorIds) {
            await this.calculateTutorScore(tutorId, schoolId);
        }

        return { recalculated: uniqueTutorIds.length };
    }

    async recalculateAllTutors(schoolId) {
        const tutors = await Tutor.find({ school_id: schoolId }).select('_id').lean();

        for (const tutor of tutors) {
            await this.calculateTutorScore(tutor._id, schoolId);
        }

        return {
            totalTutors: tutors.length,
            updatedTutors: tutors.length
        };
    }
}

module.exports = new TutorFinancialScoreService();