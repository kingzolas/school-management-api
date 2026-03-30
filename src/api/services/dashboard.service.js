const mongoose = require('mongoose');
const Student = require('../models/student.model');
const Invoice = require('../models/invoice.model');
const Staff = require('../models/user.model');
const ClassModel = require('../models/class.model');
const Subject = require('../models/subject.model');
const Expense = require('../models/expense.model');
const financeRuntime = require('./school-finance.runtime.js');

const MONTH_NAMES_PT_BR = [
  '',
  'Janeiro',
  'Fevereiro',
  'Março',
  'Abril',
  'Maio',
  'Junho',
  'Julho',
  'Agosto',
  'Setembro',
  'Outubro',
  'Novembro',
  'Dezembro',
];

class DashboardService {
  async getDashboardData(schoolId, query = {}) {
    const referenceDate = this._parseReferenceDate(
      query.referenceDate || query.date || query.reference_date,
    );
    const period = this._buildPeriodContext(referenceDate);
    const cachePayload = { referenceDate: period.referenceDateKey };
    const cached = financeRuntime.getCache(
      'dashboard:financial',
      schoolId,
      cachePayload,
    );

    if (cached && !cached.stale) {
      console.log(
        `📊 [DashboardService] Cache hit da inteligência financeira | schoolId=${schoolId} | referenceDate=${period.referenceDateKey}`,
      );
      return cached.value;
    }

    console.log(
      `📊 [DashboardService] Gerando inteligência financeira para schoolId=${schoolId} | referenceDate=${period.referenceDateKey}`,
    );

    const schoolObjectId = new mongoose.Types.ObjectId(schoolId);

    const [
      counts,
      financialMetrics,
      expenseMetrics,
      monthlyPerformance,
      birthdays,
      classDistribution,
    ] = await Promise.all([
      this._getCounts(schoolId),
      this._calculateFinancials(schoolObjectId, period),
      this._calculateExpenses(
        schoolObjectId,
        period.currentMonthStart,
        period.currentWindowEndExclusive,
      ),
      this._getMonthlyPerformance(schoolObjectId, period.year, period.referenceDate),
      this._getBirthdays(schoolObjectId),
      this._getClassDistribution(schoolObjectId),
    ]);

    const response = {
      period: this._serializePeriod(period),
      counts,
      financial: {
        ...financialMetrics,
        despesaMes: expenseMetrics.totalMonth,
        despesaPendente: expenseMetrics.totalPending,
        saldoLiquido: financialMetrics.saldoMes - expenseMetrics.totalMonth,
      },
      history: {
        year: period.year,
        performance: monthlyPerformance,
      },
      dailyChart: financialMetrics.dailyChart,
      comparisonChart: financialMetrics.comparisonChart,
      classData: classDistribution,
      birthdays,
    };

    financeRuntime.setCache(
      'dashboard:financial',
      schoolId,
      cachePayload,
      response,
    );

    return response;
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  _parseReferenceDate(rawValue) {
    if (!rawValue) {
      return this._startOfDay(new Date());
    }

    const value = Array.isArray(rawValue) ? rawValue[0] : String(rawValue).trim();
    if (!value) {
      return this._startOfDay(new Date());
    }

    const isoDateOnly = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoDateOnly) {
      const year = Number(isoDateOnly[1]);
      const month = Number(isoDateOnly[2]);
      const day = Number(isoDateOnly[3]);
      return this._startOfDay(new Date(year, month - 1, day));
    }

    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return this._startOfDay(parsed);
    }

    return this._startOfDay(new Date());
  }

  _startOfDay(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  _endOfDayExclusive(date) {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() + 1);
    return result;
  }

  _startOfMonth(date) {
    return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
  }

  _endOfMonthExclusive(date) {
    return new Date(date.getFullYear(), date.getMonth() + 1, 1, 0, 0, 0, 0);
  }

  _daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  _formatDateBr(date) {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
  }

  _formatShortDateBr(date) {
    return this._formatDateBr(date);
  }

  _formatMonthYear(date) {
    return `${this._getMonthName(date.getMonth() + 1)} ${date.getFullYear()}`;
  }

  _buildPeriodContext(referenceDate) {
    const normalized = this._startOfDay(referenceDate);
    const year = normalized.getFullYear();
    const monthIndex = normalized.getMonth();
    const referenceDay = normalized.getDate();
    const currentMonthDays = this._daysInMonth(year, monthIndex);

    const currentMonthStart = this._startOfMonth(normalized);
    const currentWindowEndExclusive = this._endOfDayExclusive(normalized);
    const currentMonthEndExclusive = this._endOfMonthExclusive(normalized);

    const previousMonthDate = new Date(year, monthIndex - 1, 1);
    const previousYear = previousMonthDate.getFullYear();
    const previousMonthIndex = previousMonthDate.getMonth();
    const previousMonthDays = this._daysInMonth(previousYear, previousMonthIndex);
    const comparisonDay = Math.min(referenceDay, previousMonthDays);
    const previousWindowReference = new Date(
      previousYear,
      previousMonthIndex,
      comparisonDay,
    );
    const previousMonthStart = this._startOfMonth(previousMonthDate);
    const previousWindowEndExclusive = this._endOfDayExclusive(
      previousWindowReference,
    );
    const previousMonthEndExclusive = this._endOfMonthExclusive(previousMonthDate);

    const currentWindowLabel = `${this._formatShortDateBr(
      currentMonthStart,
    )} a ${this._formatShortDateBr(normalized)}`;
    const previousWindowLabel = `${this._formatShortDateBr(
      previousMonthStart,
    )} a ${this._formatShortDateBr(previousWindowReference)}`;

    return {
      referenceDate: normalized,
      referenceDateKey: normalized.toISOString().split('T')[0],
      year,
      monthIndex,
      monthNumber: monthIndex + 1,
      referenceDay,
      comparisonDay,
      currentMonthDays,
      previousMonthDays,
      currentMonthStart,
      currentWindowEndExclusive,
      currentMonthEndExclusive,
      previousYear,
      previousMonthIndex,
      previousMonthStart,
      previousWindowEndExclusive,
      previousMonthEndExclusive,
      currentMonthLabel: this._formatMonthYear(normalized),
      previousMonthLabel: this._formatMonthYear(previousMonthDate),
      currentWindowLabel,
      previousWindowLabel,
    };
  }

  _serializePeriod(period) {
    return {
      referenceDate: period.referenceDate.toISOString(),
      referenceDateKey: period.referenceDateKey,
      year: period.year,
      month: period.monthNumber,
      referenceDay: period.referenceDay,
      comparisonDay: period.comparisonDay,
      currentMonthDays: period.currentMonthDays,
      previousMonthDays: period.previousMonthDays,
      monthName: period.currentMonthLabel,
      previousMonthName: period.previousMonthLabel,
      currentWindowLabel: period.currentWindowLabel,
      previousWindowLabel: period.previousWindowLabel,
    };
  }

  _buildDelta(current, previous) {
    const delta = current - previous;
    const deltaPercent = previous > 0 ? (delta / previous) * 100 : current > 0 ? 100 : 0;

    return {
      current,
      previous,
      delta,
      deltaPercent,
      trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
    };
  }

  _getMonthName(monthIndex) {
    return MONTH_NAMES_PT_BR[monthIndex] || '';
  }

  _humanizeGatewayLabel(gatewayKey) {
    const key = String(gatewayKey || '').toLowerCase();

    switch (key) {
      case 'mercadopago':
        return 'Mercado Pago';
      case 'cora':
        return 'Cora';
      case 'manual':
        return 'Manual';
      default:
        return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Manual';
    }
  }

  _humanizePaymentMethodLabel(methodKey) {
    const key = String(methodKey || '').toLowerCase();

    switch (key) {
      case 'pix':
        return 'Pix';
      case 'boleto':
        return 'Boleto';
      case 'credit_card':
      case 'creditcard':
        return 'Cartão';
      case 'manual':
        return 'Manual';
      default:
        return key ? key.charAt(0).toUpperCase() + key.slice(1) : 'Manual';
    }
  }

  _buildSourceLabel(gatewayKey, paymentMethodKey) {
    const gatewayLabel = this._humanizeGatewayLabel(gatewayKey);
    const paymentLabel = this._humanizePaymentMethodLabel(paymentMethodKey);

    if (
      gatewayLabel === 'Manual' &&
      (paymentLabel === 'Manual' || !String(paymentMethodKey || '').trim())
    ) {
      return 'Manual';
    }

    return `${gatewayLabel} • ${paymentLabel}`;
  }

  _buildDailySeries(dailyBuckets, dayLimit) {
    const values = new Map();

    for (const bucket of dailyBuckets || []) {
      const day = bucket?.day ?? bucket?._id?.day;
      const total = bucket?.value ?? bucket?.total ?? 0;

      if (day) {
        values.set(Number(day), Number(total) || 0);
      }
    }

    const result = [];
    for (let day = 1; day <= dayLimit; day++) {
      result.push({
        day,
        value: values.get(day) || 0,
      });
    }

    return result;
  }

  _toCumulativeSeries(series) {
    let cumulative = 0;

    return (series || []).map((point) => {
      cumulative += Number(point?.value || 0);
      return {
        day: point.day,
        value: Number(point?.value || 0),
        cumulative,
      };
    });
  }

  _getBestDay(dailySeries, referenceDate) {
    if (!dailySeries || dailySeries.length === 0) {
      return null;
    }

    const best = dailySeries.reduce((winner, current) => {
      if (!winner) return current;
      return (current.value || 0) > (winner.value || 0) ? current : winner;
    }, null);

    if (!best || (best.value || 0) <= 0) {
      return null;
    }

    const bestDate = new Date(
      referenceDate.getFullYear(),
      referenceDate.getMonth(),
      best.day,
    );

    return {
      day: best.day,
      label: this._formatDateBr(bestDate),
      amount: best.value,
    };
  }

  _buildLegacyPaymentMethods(sourceSummary) {
    const legacy = {
      boleto: { recebido: 0, aReceber: 0, atrasado: 0 },
      pix: { recebido: 0, aReceber: 0, atrasado: 0 },
    };

    for (const source of sourceSummary || []) {
      const methodKey = String(source.paymentMethod || '').toLowerCase();
      if (methodKey === 'boleto') {
        legacy.boleto.recebido += source.amount || 0;
      }
      if (methodKey === 'pix') {
        legacy.pix.recebido += source.amount || 0;
      }
    }

    return legacy;
  }

  _buildSummaryFromFacet(result, period, includeSources = false) {
    const received = this._firstFacet(result.received);
    const expected = this._firstFacet(result.expected);
    const overdue = this._firstFacet(result.overdue);
    const future = this._firstFacet(result.future);
    const dailyBuckets = result.daily || [];
    const daily = this._buildDailySeries(dailyBuckets, period.referenceDay);

    const sourceBuckets = includeSources ? (result.sources || []) : [];
    const totalReceived = Number(received.total || 0);

    const sources = sourceBuckets
      .map((entry) => {
        const gatewayKey = String(entry?._id?.gateway || '').toLowerCase();
        const paymentMethodKey = String(entry?._id?.paymentMethod || '').toLowerCase();
        const amount = Number(entry?.total || 0);
        const count = Number(entry?.count || 0);

        return {
          key: `${gatewayKey || 'manual'}|${paymentMethodKey || 'manual'}`,
          label: this._buildSourceLabel(gatewayKey, paymentMethodKey),
          gateway: gatewayKey || 'manual',
          gatewayLabel: this._humanizeGatewayLabel(gatewayKey),
          paymentMethod: paymentMethodKey || 'manual',
          paymentMethodLabel: this._humanizePaymentMethodLabel(paymentMethodKey),
          amount,
          count,
          share: totalReceived > 0 ? (amount / totalReceived) * 100 : 0,
        };
      })
      .sort((a, b) => b.amount - a.amount);

    return {
      receivedAmount: totalReceived,
      receivedCount: Number(received.count || 0),
      expectedAmount: Number(expected.total || 0),
      expectedCount: Number(expected.count || 0),
      overdueAmount: Number(overdue.total || 0),
      overdueCount: Number(overdue.count || 0),
      overdueStudentCount: Array.isArray(overdue.students)
        ? overdue.students.filter((student) => student != null).length
        : 0,
      futureAmount: Number(future.total || 0),
      futureCount: Number(future.count || 0),
      daily,
      sources,
    };
  }

  _firstFacet(items) {
    if (Array.isArray(items) && items.length > 0) {
      return items[0] || {};
    }

    return {};
  }

  async _getWindowSummary(
    schoolId,
    windowStart,
    windowEndExclusive,
    { dayLimit, includeSources = false } = {},
  ) {
    const pipeline = [
      { $match: { school_id: schoolId, status: { $ne: 'canceled' } } },
      {
        $addFields: {
          resolvedPaidAt: { $ifNull: ['$paidAt', '$updatedAt'] },
        },
      },
      {
        $facet: {
          received: [
            {
              $match: {
                status: 'paid',
                resolvedPaidAt: {
                  $gte: windowStart,
                  $lt: windowEndExclusive,
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $divide: ['$value', 100] } },
                count: { $sum: 1 },
              },
            },
          ],
          expected: [
            {
              $match: {
                dueDate: {
                  $gte: windowStart,
                  $lt: windowEndExclusive,
                },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $divide: ['$value', 100] } },
                count: { $sum: 1 },
              },
            },
          ],
          overdue: [
            {
              $match: {
                status: 'pending',
                dueDate: { $lt: windowEndExclusive },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $divide: ['$value', 100] } },
                count: { $sum: 1 },
                students: { $addToSet: '$student' },
              },
            },
          ],
          future: [
            {
              $match: {
                status: 'pending',
                dueDate: { $gte: windowEndExclusive },
              },
            },
            {
              $group: {
                _id: null,
                total: { $sum: { $divide: ['$value', 100] } },
                count: { $sum: 1 },
              },
            },
          ],
          daily: [
            {
              $match: {
                status: 'paid',
                resolvedPaidAt: {
                  $gte: windowStart,
                  $lt: windowEndExclusive,
                },
              },
            },
            {
              $group: {
                _id: { day: { $dayOfMonth: '$resolvedPaidAt' } },
                value: { $sum: { $divide: ['$value', 100] } },
              },
            },
            { $sort: { '_id.day': 1 } },
          ],
          sources: includeSources
            ? [
                {
                  $match: {
                    status: 'paid',
                    resolvedPaidAt: {
                      $gte: windowStart,
                      $lt: windowEndExclusive,
                    },
                  },
                },
                {
                  $group: {
                    _id: {
                      gateway: { $ifNull: ['$gateway', 'manual'] },
                      paymentMethod: { $ifNull: ['$paymentMethod', 'manual'] },
                    },
                    total: { $sum: { $divide: ['$value', 100] } },
                    count: { $sum: 1 },
                  },
                },
                { $sort: { total: -1 } },
              ]
            : [{ $limit: 0 }],
        },
      },
    ];

    const [result = {}] = await Invoice.aggregate(pipeline);
    return this._buildSummaryFromFacet(
      result,
      {
        referenceDay: dayLimit,
      },
      includeSources,
    );
  }

  async _calculateFinancials(schoolId, period) {
    const [currentSummary, previousSummary, previousClosedSummary] =
      await Promise.all([
        this._getWindowSummary(
          schoolId,
          period.currentMonthStart,
          period.currentWindowEndExclusive,
          {
            dayLimit: period.referenceDay,
            includeSources: true,
          },
        ),
        this._getWindowSummary(
          schoolId,
          period.previousMonthStart,
          period.previousWindowEndExclusive,
          {
            dayLimit: period.comparisonDay,
            includeSources: false,
          },
        ),
        this._getWindowSummary(
          schoolId,
          period.previousMonthStart,
          period.previousMonthEndExclusive,
          {
            dayLimit: period.previousMonthDays,
            includeSources: false,
          },
        ),
      ]);

    const receivedDelta = currentSummary.receivedAmount - previousSummary.receivedAmount;
    const receivedDeltaPercent =
      previousSummary.receivedAmount > 0
        ? (receivedDelta / previousSummary.receivedAmount) * 100
        : currentSummary.receivedAmount > 0
          ? 100
          : 0;

    const currentOpenPortfolio =
      currentSummary.futureAmount + currentSummary.overdueAmount;
    const previousOpenPortfolio =
      previousSummary.futureAmount + previousSummary.overdueAmount;

    const currentCollectionRate =
      currentSummary.expectedAmount > 0
        ? (currentSummary.receivedAmount / currentSummary.expectedAmount) * 100
        : 0;
    const previousCollectionRate =
      previousSummary.expectedAmount > 0
        ? (previousSummary.receivedAmount / previousSummary.expectedAmount) * 100
        : 0;

    const currentPaidCount = currentSummary.receivedCount;
    const previousPaidCount = previousSummary.receivedCount;
    const currentPendingCount = currentSummary.futureCount;
    const previousPendingCount = previousSummary.futureCount;
    const currentOverdueCount = currentSummary.overdueCount;
    const previousOverdueCount = previousSummary.overdueCount;

    const saldoDia = this._dailyAmountForDay(currentSummary.daily, period.referenceDay);
    const bestDay = this._getBestDay(currentSummary.daily, period.referenceDate);
    const sources = currentSummary.sources || [];
    const metodos = this._buildLegacyPaymentMethods(sources);
    const dominantSource = sources[0] || null;

    return {
      saldoDia,
      saldoMes: currentSummary.receivedAmount,
      totalAVencer: currentSummary.futureAmount,
      totalVencido: currentSummary.overdueAmount,
      inadimplenciaAlunos: currentSummary.overdueStudentCount,
      inadimplenciaTaxa:
        currentOpenPortfolio > 0
          ? ((currentSummary.overdueAmount / currentOpenPortfolio) * 100).toFixed(1)
          : '0.0',
      metodos,
      comparison: {
        received: this._buildDelta(
          currentSummary.receivedAmount,
          previousSummary.receivedAmount,
        ),
        expected: this._buildDelta(
          currentSummary.expectedAmount,
          previousSummary.expectedAmount,
        ),
        openPortfolio: this._buildDelta(currentOpenPortfolio, previousOpenPortfolio),
        collectionRate: this._buildDelta(
          currentCollectionRate,
          previousCollectionRate,
        ),
        paidCount: this._buildDelta(currentPaidCount, previousPaidCount),
        pendingCount: this._buildDelta(currentPendingCount, previousPendingCount),
        overdueCount: this._buildDelta(currentOverdueCount, previousOverdueCount),
      },
      receivedToDate: currentSummary.receivedAmount,
      previousReceivedToDate: previousSummary.receivedAmount,
      receivedDelta,
      receivedDeltaPercent,
      expectedToDate: currentSummary.expectedAmount,
      previousExpectedToDate: previousSummary.expectedAmount,
      openPortfolio: currentOpenPortfolio,
      paidInvoicesCount: currentPaidCount,
      pendingInvoicesCount: currentPendingCount,
      overdueInvoicesCount: currentOverdueCount,
      collectionRate: currentCollectionRate,
      ticketAverage:
        currentPaidCount > 0 ? currentSummary.receivedAmount / currentPaidCount : 0,
      bestDay,
      previousClosedMonth: {
        label: period.previousMonthLabel,
        received: previousClosedSummary.receivedAmount,
        expected: previousClosedSummary.expectedAmount,
        collectionRate:
          previousClosedSummary.expectedAmount > 0
            ? (previousClosedSummary.receivedAmount /
                previousClosedSummary.expectedAmount) *
              100
            : 0,
      },
      dominantGateway: dominantSource ? dominantSource.gatewayLabel : null,
      dominantPaymentMethod: dominantSource ? dominantSource.paymentMethodLabel : null,
      sources,
      dailyChart: currentSummary.daily,
      comparisonChart: {
        referenceDay: period.referenceDay,
        currentLabel: period.currentMonthLabel,
        previousLabel: period.previousMonthLabel,
        current: currentSummary.daily,
        previous: previousSummary.daily,
      },
    };
  }

  _dailyAmountForDay(dailySeries, day) {
    if (!Array.isArray(dailySeries) || dailySeries.length === 0) {
      return 0;
    }

    const entry = dailySeries.find((item) => item.day === day);
    return entry ? Number(entry.value || 0) : 0;
  }

  // =========================================================================
  // Existing analytics helpers
  // =========================================================================

  async _getCounts(schoolId) {
    const [students, teachers, classes, subjects] = await Promise.all([
      Student.countDocuments({ school_id: schoolId, isActive: true }),
      Staff.countDocuments({
        school_id: schoolId,
        $or: [
          { role: 'teacher' },
          { roles: { $in: ['Professor', 'Teacher', 'teacher'] } },
        ],
      }),
      ClassModel.countDocuments({ school_id: schoolId }),
      Subject.countDocuments({ school_id: schoolId }),
    ]);

    return { students, teachers, classes, subjects };
  }

  async _getMonthlyPerformance(schoolId, year, referenceDate) {
    const startOfYear = new Date(year, 0, 1);
    const endOfYearExclusive = new Date(year + 1, 0, 1);
    const cutoffDate = referenceDate ? this._endOfDayExclusive(referenceDate) : new Date();

    const performance = await Invoice.aggregate([
      {
        $match: {
          school_id: schoolId,
          dueDate: { $gte: startOfYear, $lt: endOfYearExclusive },
          status: { $ne: 'canceled' },
        },
      },
      {
        $group: {
          _id: { month: { $month: '$dueDate' } },
          totalExpected: { $sum: { $divide: ['$value', 100] } },
          totalPaid: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'paid'] },
                    { $lt: ['$paidAt', cutoffDate] },
                  ],
                },
                { $divide: ['$value', 100] },
                0,
              ],
            },
          },
          totalOverdue: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$status', 'pending'] },
                    { $lt: ['$dueDate', cutoffDate] },
                  ],
                },
                { $divide: ['$value', 100] },
                0,
              ],
            },
          },
          uniqueStudents: { $addToSet: '$student' },
        },
      },
      { $sort: { '_id.month': 1 } },
    ]);

    const map = new Map(
      performance.map((item) => [item?._id?.month, item]),
    );

    return Array.from({ length: 12 }, (_, index) => {
      const month = index + 1;
      const item = map.get(month) || {};
      const totalExpected = Number(item.totalExpected || 0);
      const totalPaid = Number(item.totalPaid || 0);
      const totalOverdue = Number(item.totalOverdue || 0);
      const studentCount = Array.isArray(item.uniqueStudents)
        ? item.uniqueStudents.filter((student) => student != null).length
        : 0;

      return {
        month,
        monthName: this._getMonthName(month),
        studentCount,
        financial: {
          expected: totalExpected,
          paid: totalPaid,
          overdue: totalOverdue,
          collectionRate: totalExpected > 0 ? (totalPaid / totalExpected) * 100 : 0,
        },
      };
    });
  }

  async _calculateExpenses(schoolId, startOfMonth, endExclusive) {
    const result = await Expense.aggregate([
      { $match: { schoolId: schoolId } },
      {
        $group: {
          _id: null,
          totalMonth: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $gte: ['$date', startOfMonth] },
                    { $lt: ['$date', endExclusive] },
                  ],
                },
                '$amount',
                0,
              ],
            },
          },
          totalPending: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, '$amount', 0] },
          },
        },
      },
    ]);

    return result[0] || { totalMonth: 0, totalPending: 0 };
  }

  async _getBirthdays(schoolId) {
    const currentMonth = new Date().getMonth() + 1;
    return await Student.aggregate([
      {
        $match: {
          school_id: schoolId,
          isActive: true,
          $expr: { $eq: [{ $month: '$birthDate' }, currentMonth] },
        },
      },
      { $project: { fullName: 1, birthDate: 1, profilePicture: 1 } },
      { $sort: { birthDate: 1 } },
      { $limit: 5 },
    ]);
  }

  async _getClassDistribution(schoolId) {
    const result = await Student.aggregate([
      { $match: { school_id: schoolId, isActive: true } },
      {
        $group: {
          _id: '$class_id',
          count: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'classes',
          localField: '_id',
          foreignField: '_id',
          as: 'classInfo',
        },
      },
      { $unwind: '$classInfo' },
      {
        $project: {
          className: '$classInfo.name',
          count: 1,
        },
      },
      { $sort: { count: -1 } },
    ]);

    const totalStudents = result.reduce((acc, curr) => acc + curr.count, 0);
    return result.map((item) => ({
      className: item.className,
      studentCount: item.count,
      percentage:
        totalStudents > 0 ? ((item.count / totalStudents) * 100).toFixed(1) : '0',
    }));
  }
}

module.exports = new DashboardService();
