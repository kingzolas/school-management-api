const mongoose = require('mongoose');
const crypto = require('crypto');
const NegotiationModel = require('../models/negotiation.model');
const InvoiceModel = require('../models/invoice.model');
const SchoolModel = require('../models/school.model'); // Necessário para buscar credenciais

// --- MERCADO PAGO CONFIG ---
const { MercadoPagoConfig, Payment } = require('mercadopago');
require('dotenv').config();

const isProduction = process.env.NODE_ENV === 'production';
const NOTIFICATION_BASE_URL = isProduction ? process.env.PROD_URL : process.env.NGROK_URL;

class NegotiationService {

    /**
     * [HELPER PRIVADO]
     * Busca as credenciais da escola e retorna uma instância configurada do Mercado Pago
     */
    async _getMpClient(schoolId) {
        const school = await SchoolModel.findById(schoolId).select('+mercadoPagoConfig.prodAccessToken');
        
        if (!school) {
            throw new Error('Escola não encontrada para processar pagamento.');
        }

        if (!school.mercadoPagoConfig || !school.mercadoPagoConfig.prodAccessToken) {
            throw new Error('As credenciais do Mercado Pago não estão configuradas para esta escola.');
        }

        const client = new MercadoPagoConfig({
            accessToken: school.mercadoPagoConfig.prodAccessToken,
            options: { timeout: 5000 }
        });

        const paymentClient = new Payment(client);
        
        return { client, paymentClient };
    }

    /**
     * Cria a negociação, aplicando school_id e createdByUserId.
     */
    async createNegotiation(data, schoolId, createdByUserId) {
        const { studentId, invoiceIds, rules } = data;

        const invoices = await InvoiceModel.find({ _id: { $in: invoiceIds } });
        
        if (!invoices || invoices.length === 0) {
            throw new Error("Nenhuma fatura válida encontrada.");
        }

        const totalDebt = invoices.reduce((acc, inv) => {
            const val = inv.value || inv.amount || 0; 
            return acc + Number(val);
        }, 0);

        const token = crypto.randomBytes(20).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 48); 

        const negotiation = new NegotiationModel({
            studentId,
            invoices: invoiceIds,
            token,
            rules,
            totalOriginalDebt: totalDebt,
            expiresAt,
            status: 'PENDING',
            school_id: schoolId,          
            createdByUserId: createdByUserId 
        });

        await negotiation.save();
        return negotiation;
    }

    /**
     * Lista histórico, garantindo que o gestor só veja negociações de sua escola.
     */
    async listByStudent(studentId, schoolId) {
        return await NegotiationModel.find({ studentId, school_id: schoolId })
            .populate('invoices')
            .sort({ createdAt: -1 });
    }

    // --- ROTAS PÚBLICAS (validateAccess, generatePayment, getStatus) ---
    // A lógica dessas rotas é mantida, pois a segurança é garantida pelo 'token' único.

    async validateAccess(token, inputCpf) {
        const negotiation = await NegotiationModel.findOne({ token })
            .populate({
                path: 'studentId',
                populate: { 
                    path: 'tutors.tutorId',
                    model: 'Tutor',
                    strictPopulate: false
                }
            })
            .populate('invoices');

        if (!negotiation) throw new Error("Negociação não encontrada.");
        if (new Date() > negotiation.expiresAt) throw new Error("Este link expirou.");
        if (negotiation.status === 'PAID') throw new Error("Esta negociação já foi paga.");

        const student = negotiation.studentId;
        const inCpf = inputCpf.replace(/\D/g, '');

        let foundTutor = null;
        if (student.tutors && student.tutors.length > 0) {
            for (const t of student.tutors) {
                if (t.tutorId && t.tutorId.cpf) {
                    const tutorCpf = t.tutorId.cpf.replace(/\D/g, '');
                    if (tutorCpf === inCpf) {
                        foundTutor = t.tutorId;
                        break;
                    }
                }
            }
        }

        if (!foundTutor && student.cpf && student.cpf.replace(/\D/g, '') === inCpf) {
            foundTutor = student; 
        }

        if (!foundTutor) {
            throw new Error("CPF informado não confere com nenhum responsável cadastrado.");
        }

        return {
            studentName: student.fullName || student.name,
            tutorName: foundTutor.fullName || foundTutor.name,
            totalDebt: negotiation.totalOriginalDebt, 
            rules: negotiation.rules,
            status: negotiation.status,
            expiresAt: negotiation.expiresAt,
            invoices: negotiation.invoices.map(inv => ({
                description: inv.description,
                value: inv.value,
                dueDate: inv.dueDate
            }))
        };
    }

    async generatePayment(token, method, paymentData = {}) {
        const negotiation = await NegotiationModel.findOne({ token })
            .populate({
                path: 'studentId',
                populate: { 
                    path: 'tutors.tutorId',
                    model: 'Tutor',
                    strictPopulate: false
                }
            });

        if (!negotiation) throw new Error("Negociação não encontrada.");
        if (negotiation.status === 'PAID') throw new Error("Negociação já está paga.");
        
        // [MODIFICAÇÃO MULTI-TENANT]
        // Usa o school_id da negociação para buscar a credencial correta
        const { paymentClient } = await this._getMpClient(negotiation.school_id);

        const student = negotiation.studentId;
        
        let payerEntity = student; 
        if (student.tutors && student.tutors.length > 0 && student.tutors[0].tutorId) {
            payerEntity = student.tutors[0].tutorId;
        }

        const payerEmail = isProduction ? (payerEntity.email || 'email@padrao.com') : "test_user_123@testuser.com";
        const cpfClean = payerEntity.cpf ? payerEntity.cpf.replace(/\D/g, '') : ''; 

        const fullName = payerEntity.fullName || 'Responsável';
        const names = fullName.trim().split(' ');
        const firstName = names[0];
        const lastName = names.length > 1 ? names.slice(1).join(' ') : 'Financeiro';

        // --- CÁLCULO DO VALOR FINAL (COM DESCONTO) ---
        let finalAmountCents = negotiation.totalOriginalDebt;

        if (method === 'pix' && negotiation.rules && negotiation.rules.allowPixDiscount) {
            const discountVal = negotiation.rules.pixDiscountValue || 0;
            // Usa o novo campo pixDiscountType
            const discountType = negotiation.rules.pixDiscountType || 'percentage'; 

            if (discountVal > 0) {
                if (discountType === 'percentage') {
                    const discountAmount = finalAmountCents * (discountVal / 100);
                    finalAmountCents = finalAmountCents - discountAmount;
                } else {
                    const discountAmountCents = discountVal * 100;
                    finalAmountCents = finalAmountCents - discountAmountCents;
                }
            }
        }

        if (finalAmountCents < 0) finalAmountCents = 0;

        const amountInReais = parseFloat((finalAmountCents / 100).toFixed(2));

        console.log(`[NegotiationService] Valor Original: ${(negotiation.totalOriginalDebt/100).toFixed(2)} | Valor Final (${method}): ${amountInReais}`);

        let paymentBody = {
            transaction_amount: amountInReais, 
            description: `Acordo - ${student.fullName}`,
            notification_url: `${NOTIFICATION_BASE_URL}/api/webhook/mp-negotiation`,
            payer: {
                email: payerEmail,
                first_name: firstName,
                last_name: lastName,
                identification: { type: 'CPF', number: cpfClean }
            },
            metadata: {
                negotiation_id: negotiation._id.toString(),
                token: negotiation.token
            }
        };

        try {
            let paymentResponse;

            // --- PIX ---
            if (method === 'pix') {
                const expirationDate = new Date();
                expirationDate.setHours(expirationDate.getHours() + 24);

                paymentBody = {
                    ...paymentBody,
                    payment_method_id: 'pix',
                    date_of_expiration: expirationDate.toISOString(),
                };

                console.log(`[NegotiationService] Criando PIX no MP...`);
                paymentResponse = await paymentClient.create({ body: paymentBody });
                
                const responseData = paymentResponse; 
                negotiation.paymentExternalId = responseData.id.toString();
                await negotiation.save();

                return {
                    type: 'pix',
                    status: responseData.status,
                    qrCode: responseData.point_of_interaction.transaction_data.qr_code,
                    copyPaste: responseData.point_of_interaction.transaction_data.qr_code,
                    qrCodeBase64: responseData.point_of_interaction.transaction_data.qr_code_base64,
                    ticketUrl: responseData.point_of_interaction.transaction_data.ticket_url
                };
            } 
            
            // --- CARTÃO ---
            else if (method === 'credit_card') {
                if (!paymentData.token) throw new Error("Token do cartão é obrigatório.");
                
                paymentBody = {
                    ...paymentBody,
                    token: paymentData.token,
                    installments: Number(paymentData.installments),
                    payment_method_id: paymentData.paymentMethodId,
                    issuer_id: paymentData.issuerId, 
                };

                console.log(`[NegotiationService] Processando Cartão no MP...`);
                paymentResponse = await paymentClient.create({ body: paymentBody });
                const responseData = paymentResponse;

                if (responseData.status === 'rejected') throw new Error(`Pagamento recusado: ${responseData.status_detail}`);

                negotiation.paymentExternalId = responseData.id.toString();
                
                if (responseData.status === 'approved') {
                    negotiation.status = 'PAID';
                    await this._markInvoicesAsPaid(negotiation.invoices);
                }
                await negotiation.save();

                return {
                    type: 'credit_card',
                    status: responseData.status,
                    statusDetail: responseData.status_detail,
                    id: responseData.id
                };
            } 
            else {
                throw new Error("Método inválido.");
            }

        } catch (error) {
            console.error('Erro no Mercado Pago:', error);
            const mpError = error.cause && error.cause[0] ? error.cause[0].description : error.message;
            throw new Error(`Erro no pagamento: ${mpError}`);
        }
    }

    async getStatus(token) {
        const negotiation = await NegotiationModel.findOne({ token }, 'status expiresAt');
        if (!negotiation) throw new Error("Negociação não encontrada.");
        if (negotiation.status === 'PENDING' && new Date() > negotiation.expiresAt) {
            return 'EXPIRED';
        }
        return negotiation.status;
    }

    async _markInvoicesAsPaid(invoiceIds) {
        if(!invoiceIds || invoiceIds.length === 0) return;
        await InvoiceModel.updateMany(
            { _id: { $in: invoiceIds } },
            { $set: { status: 'paid', paidAt: new Date(), paymentMethod: 'negotiation' } }
        );
    }
}

module.exports = new NegotiationService();