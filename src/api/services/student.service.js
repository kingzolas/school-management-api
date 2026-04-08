// src/api/services/student.service.js
const mongoose = require('mongoose'); 
const Student = require('../models/student.model');
const Tutor = require('../models/tutor.model'); 
// [NOVO] Importamos o helper
const dbHelper = require('../../helpers/dbHelper'); 
const attendanceService = require('./attendance.service');
const studentNoteService = require('./studentNote.service');
const { ensureStudentEnrollmentAccess } = require('./classAccess.service');
const { buildBirthDateKey, normalizeName } = require('../utils/guardianAccess.util');

const tutorPopulation = {
    path: 'tutors.tutorId', 
    model: 'Tutor', 
    select: '-students -__v' 
};

const isValidObjectId = (value) =>
    typeof value === 'string' && mongoose.Types.ObjectId.isValid(value);

class StudentService {

    _normalizeTutorAddress(address = {}) {
        const rawAddress = address && typeof address === 'object' ? address : {};

        return {
            street: rawAddress.street || '',
            neighborhood: rawAddress.neighborhood || '',
            number: rawAddress.number || '',
            block: rawAddress.block || '',
            lot: rawAddress.lot || '',
            cep: rawAddress.cep || rawAddress.zipCode || '',
            city: rawAddress.city || '',
            state: rawAddress.state || '',
        };
    }

    _buildTutorPayload(tutorData = {}, schoolId) {
        const {
            relationship,
            tutorId,
            id,
            _id,
            financialScore,
            students,
            address,
            ...rest
        } = tutorData || {};

        const tutorPayload = {
            ...rest,
            address: this._normalizeTutorAddress(address),
            school_id: schoolId,
        };

        if (_id && !_id.startsWith('temp-')) {
            tutorPayload._id = _id;
        } else if (id && !id.startsWith('temp-')) {
            tutorPayload._id = id;
        }

        if (financialScore) {
            delete tutorPayload.financialScore;
        }

        if (students) {
            delete tutorPayload.students;
        }

        return {
            relationship,
            tutorPayload,
            incomingTutorId: tutorId || _id || id || null,
        };
    }

    async _upsertTutorFromPayload(tutorData = {}, schoolId) {
        const { relationship, tutorPayload, incomingTutorId } =
            this._buildTutorPayload(tutorData, schoolId);

        if (!relationship) {
            return null;
        }

        let tutorDoc = null;

        if (isValidObjectId(incomingTutorId)) {
            tutorDoc = await Tutor.findOne({
                _id: incomingTutorId,
                school_id: schoolId,
            });
        }

        if (!tutorDoc && tutorPayload.cpf) {
            tutorDoc = await Tutor.findOne({
                cpf: tutorPayload.cpf,
                school_id: schoolId,
            });
        }

        if (tutorDoc) {
            Object.assign(tutorDoc, tutorPayload);
            await tutorDoc.save();
        } else {
            tutorDoc = new Tutor(tutorPayload);
            await tutorDoc.save();
        }

        return {
            tutorDoc,
            relationship,
        };
    }

    async _resolveTutorLinks(tutorsFromFlutter = [], schoolId) {
        if (!Array.isArray(tutorsFromFlutter) || tutorsFromFlutter.length === 0) {
            return [];
        }

        const tutorsForStudentSchema = [];
        const seenTutorIds = new Set();

        for (const tutorData of tutorsFromFlutter) {
            const resolved = await this._upsertTutorFromPayload(tutorData, schoolId);
            if (!resolved?.tutorDoc) continue;

            const tutorId = String(resolved.tutorDoc._id);
            if (seenTutorIds.has(tutorId)) continue;
            seenTutorIds.add(tutorId);

            tutorsForStudentSchema.push({
                tutorId: resolved.tutorDoc._id,
                relationship: resolved.relationship,
            });
        }

        return tutorsForStudentSchema;
    }

    async _syncTutorStudentLinks(tutorLinks = [], studentId) {
        const tutorIds = tutorLinks
            .map((link) => link?.tutorId)
            .filter(Boolean);

        if (!tutorIds.length) {
            return;
        }

        await Tutor.updateMany(
            { _id: { $in: tutorIds } },
            { $addToSet: { students: studentId } }
        );
    }

    _normalizeText(value) {
        const text = String(value ?? '').trim();
        return text ? text : null;
    }

    _stripAccents(value) {
        return String(value ?? '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    _normalizeRelationshipKey(relationship) {
        return this._stripAccents(relationship).toLowerCase().trim();
    }

    _calculateAge(birthDate) {
        if (!birthDate) return null;

        const date = new Date(birthDate);
        if (Number.isNaN(date.getTime())) return null;

        const today = new Date();
        let age = today.getFullYear() - date.getFullYear();
        const monthDiff = today.getMonth() - date.getMonth();

        if (
            monthDiff < 0 ||
            (monthDiff === 0 && today.getDate() < date.getDate())
        ) {
            age -= 1;
        }

        return age;
    }

    _buildBirthdayInfo(birthDate) {
        if (!birthDate) {
            return {
                day: null,
                month: null,
                label: null,
                isToday: false,
            };
        }

        const date = new Date(birthDate);
        if (Number.isNaN(date.getTime())) {
            return {
                day: null,
                month: null,
                label: null,
                isToday: false,
            };
        }

        const day = date.getDate();
        const month = date.getMonth() + 1;
        const today = new Date();
        const isToday =
            today.getDate() === date.getDate() &&
            today.getMonth() === date.getMonth();

        return {
            day,
            month,
            label: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`,
            isToday,
        };
    }

    _buildGuardianContact(link = {}) {
        const tutor =
            link?.tutorId && typeof link.tutorId === 'object'
                ? link.tutorId
                : null;

        const name = this._normalizeText(tutor?.fullName);
        if (!name) return null;

        return {
            id: String(tutor._id || ''),
            name,
            relationship: this._normalizeText(link.relationship) || 'Responsavel',
            phoneNumber: this._normalizeText(tutor?.phoneNumber),
        };
    }

    _buildTeacherSafeGuardians(student) {
        const links = Array.isArray(student?.tutors) ? student.tutors : [];
        const contacts = [];
        const seen = new Set();
        let father = null;
        let mother = null;

        links.forEach((link) => {
            const contact = this._buildGuardianContact(link);
            if (!contact) return;

            const dedupeKey = `${contact.id}:${contact.relationship}:${contact.name}`;
            if (!seen.has(dedupeKey)) {
                seen.add(dedupeKey);
                contacts.push(contact);
            }

            const relationshipKey = this._normalizeRelationshipKey(contact.relationship);
            if (!father && relationshipKey === 'pai') {
                father = contact;
            }
            if (!mother && relationshipKey === 'mae') {
                mother = contact;
            }
        });

        return {
            father,
            mother,
            contacts,
        };
    }

    _pushHealthAlert(alerts, key, label, details, fallbackDescription) {
        const normalizedDetails = this._normalizeText(details);
        if (!normalizedDetails && !fallbackDescription) return;

        alerts.push({
            key,
            label,
            description: normalizedDetails || fallbackDescription,
        });
    }

    _buildTeacherSafeHealth(healthInfo = {}) {
        const alerts = [];

        if (healthInfo?.hasAllergy) {
            this._pushHealthAlert(
                alerts,
                'allergy',
                'Alergias',
                healthInfo.allergyDetails,
                'Possui alergias registradas.'
            );
        }

        if (healthInfo?.hasMedicationAllergy) {
            this._pushHealthAlert(
                alerts,
                'medication_allergy',
                'Alergia a medicacao',
                healthInfo.medicationAllergyDetails,
                'Possui alergia a medicacao.'
            );
        }

        if (healthInfo?.takesMedication) {
            this._pushHealthAlert(
                alerts,
                'continuous_medication',
                'Medicacao continua',
                healthInfo.medicationDetails,
                'Usa medicacao continua.'
            );
        }

        if (healthInfo?.hasHealthProblem) {
            this._pushHealthAlert(
                alerts,
                'health_condition',
                'Condicao de saude',
                healthInfo.healthProblemDetails,
                'Possui observacao de saude relevante.'
            );
        }

        if (healthInfo?.hasDisability) {
            this._pushHealthAlert(
                alerts,
                'disability',
                'Deficiencia ou adaptacao',
                healthInfo.disabilityDetails,
                'Possui necessidade de atencao relacionada a deficiencia.'
            );
        }

        if (healthInfo?.hasVisionProblem) {
            this._pushHealthAlert(
                alerts,
                'vision_problem',
                'Visao',
                healthInfo.visionProblemDetails,
                'Possui observacao de visao.'
            );
        }

        if (this._normalizeText(healthInfo?.feverMedication)) {
            this._pushHealthAlert(
                alerts,
                'fever_guidance',
                'Orientacao para febre',
                healthInfo.feverMedication,
                null
            );
        }

        if (this._normalizeText(healthInfo?.foodObservations)) {
            this._pushHealthAlert(
                alerts,
                'food_observation',
                'Observacao alimentar',
                healthInfo.foodObservations,
                null
            );
        }

        return {
            hasAlerts: alerts.length > 0,
            allergies: this._normalizeText(healthInfo?.allergyDetails),
            medicationAllergies: this._normalizeText(healthInfo?.medicationAllergyDetails),
            continuousMedication: this._normalizeText(healthInfo?.medicationDetails),
            healthCondition: this._normalizeText(healthInfo?.healthProblemDetails),
            disability: this._normalizeText(healthInfo?.disabilityDetails),
            visionProblem: this._normalizeText(healthInfo?.visionProblemDetails),
            feverGuidance: this._normalizeText(healthInfo?.feverMedication),
            foodObservations: this._normalizeText(healthInfo?.foodObservations),
            alerts,
        };
    }

    _serializeTeacherSafeNote(note) {
        if (!note) return null;

        const payload =
            typeof note.toObject === 'function'
                ? note.toObject({ virtuals: false })
                : { ...note };

        return {
            _id: String(payload._id || ''),
            schoolId: String(payload.schoolId || ''),
            studentId:
                payload.studentId && typeof payload.studentId === 'object'
                    ? String(payload.studentId._id || '')
                    : String(payload.studentId || ''),
            createdBy:
                payload.createdBy && typeof payload.createdBy === 'object'
                    ? {
                          _id: String(payload.createdBy._id || ''),
                          fullName: payload.createdBy.fullName || '',
                          profilePictureUrl: payload.createdBy.profilePictureUrl || null,
                      }
                    : null,
            type: payload.type || 'PRIVATE',
            title: payload.title || '',
            description: payload.description || '',
            isResolved: Boolean(payload.isResolved),
            createdAt: payload.createdAt || null,
            updatedAt: payload.updatedAt || null,
        };
    }

    /**
     * Cria um novo aluno, GERA MATRÍCULA e salva FOTO.
     * [ALTERAÇÃO] Adicionado param 'user' para auditoria
     */
    async createStudent(studentData, schoolId, photoFile, user) {
        const { tutors: tutorsFromFlutter, ...studentInfo } = studentData; 
        
        // 1. Processamento da Imagem
        if (photoFile) {
            studentInfo.profilePicture = {
                data: photoFile.buffer,
                contentType: photoFile.mimetype
            };
        }

        const tutorsForStudentSchema = await this._resolveTutorLinks(
            tutorsFromFlutter,
            schoolId
        );
        
        // 2. Instancia o aluno
        const newStudent = new Student({
            ...studentInfo,
            tutors: tutorsForStudentSchema,
            school_id: schoolId 
        });

        // 3. Gera matrícula
        newStudent.enrollmentNumber = newStudent._id.toString().substring(0, 8).toUpperCase();

        // [AUDITORIA] Injetamos o usuário no documento antes de salvar
        // O Plugin vai ler essa propriedade '._user' para criar o log
        if (user) newStudent._user = user;

        await newStudent.save();

        // Atualiza os tutores
        await this._syncTutorStudentLinks(tutorsForStudentSchema, newStudent._id);

        // 4. Retorno leve
        const populatedStudent = await Student.findById(newStudent._id)
                                              .select('-profilePicture.data') 
                                              .populate(tutorPopulation);
        
        return populatedStudent;
    }

    // --- Métodos de Leitura (Não mudam, pois não geram log) ---

    async getAllStudents(schoolId) {
        return await Student.find({ school_id: schoolId })
                            .select('-profilePicture.data') 
                            .populate(tutorPopulation);
    }

    async getStudentById(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .select('-profilePicture.data')
                                     .populate(tutorPopulation);
        if (!student) throw new Error('Aluno não encontrado.');
        return student;
    }

    async getTeacherSummary({ schoolId, classId, studentId, currentUser }) {
        const { classDoc, enrollment } = await ensureStudentEnrollmentAccess({
            actor: currentUser,
            schoolId,
            classId,
            studentId,
            allowedStatuses: ['Ativa'],
        });

        const student = await Student.findOne({
            _id: studentId,
            school_id: schoolId,
        })
            .select('fullName enrollmentNumber birthDate gender healthInfo tutors')
            .populate({
                path: 'tutors.tutorId',
                model: 'Tutor',
                select: 'fullName phoneNumber',
            });

        if (!student) {
            throw new Error('Aluno nao encontrado.');
        }

        const recentAttendance = await attendanceService.getStudentRecentHistorySummary({
            schoolId,
            classId,
            studentId,
            actor: currentUser,
            limit: 7,
            skipAccessCheck: true,
        });

        const notes = await studentNoteService.listStudentNotes(
            schoolId,
            studentId,
            currentUser,
            { limit: 10 }
        );

        return {
            class: {
                id: String(classDoc._id),
                name: classDoc.name || '',
                grade: classDoc.grade || '',
                shift: classDoc.shift || '',
                schoolYear: classDoc.schoolYear || null,
            },
            student: {
                id: String(student._id),
                fullName: student.fullName || '',
                enrollmentNumber: this._normalizeText(student.enrollmentNumber),
                birthDate: student.birthDate || null,
                age: this._calculateAge(student.birthDate),
                birthday: this._buildBirthdayInfo(student.birthDate),
                gender: this._normalizeText(student.gender),
            },
            enrollment: {
                id: String(enrollment._id),
                status: enrollment.status || null,
                enrollmentDate: enrollment.enrollmentDate || null,
                academicYear: enrollment.academicYear || null,
            },
            guardians: this._buildTeacherSafeGuardians(student),
            health: this._buildTeacherSafeHealth(student.healthInfo || {}),
            recentAttendance,
            notes: Array.isArray(notes)
                ? notes.map((note) => this._serializeTeacherSafeNote(note)).filter(Boolean)
                : [],
        };
    }

    async getStudentPhoto(id, schoolId) {
        const student = await Student.findOne({ _id: id, school_id: schoolId })
                                     .select('profilePicture');
        if (!student?.profilePicture?.data) throw new Error('Foto não encontrada.');
        return student.profilePicture; 
    }

    /**
     * Atualiza aluno.
     * [ALTERAÇÃO] Adicionado 'user' e 'reason'
     * [USO] Utiliza dbHelper.updateWithAudit
     */
    async updateStudent(id, studentData, schoolId, photoFile, user, reason) {
        
        const updatePayload = { ...studentData };

        if (Object.prototype.hasOwnProperty.call(updatePayload, 'fullName')) {
            updatePayload.fullNameNormalized = normalizeName(updatePayload.fullName);
        }

        if (Object.prototype.hasOwnProperty.call(updatePayload, 'birthDate')) {
            updatePayload.birthDateKey = buildBirthDateKey(updatePayload.birthDate);
        }

        const tutorsFromFlutter = updatePayload.tutors;
        if (Array.isArray(tutorsFromFlutter)) {
            updatePayload.tutors = await this._resolveTutorLinks(
                tutorsFromFlutter,
                schoolId
            );
        }

        if (photoFile) {
            updatePayload.profilePicture = {
                data: photoFile.buffer,
                contentType: photoFile.mimetype
            };
        }

        // [AUDITORIA] Usando o dbHelper
        // Assumindo que seu dbHelper foi ajustado para aceitar (Model, Query, Data, Options)
        // ou você chama o Model direto com as options se o helper for só para controllers.
        
        // Opção A: Chamada direta Mongoose (Mais limpa para Services)
        const updatedStudent = await Student.findOneAndUpdate(
            { _id: id, school_id: schoolId }, 
            updatePayload,                      
            { 
                new: true, 
                runValidators: true,
                user: user,     // Passa o contexto pro Plugin
                reason: reason  // Passa o motivo pro Plugin
            }
        )
        .select('-profilePicture.data')
        .populate(tutorPopulation);
        
        // Opção B: Se usar dbHelper.updateWithAudit(Student, id, data, req), 
        // você teria que passar 'req', o que suja o Service. 
        // Recomendo a Opção A acima para Services.

        if (!updatedStudent) {
            throw new Error('Aluno não encontrado ou não pertence a esta escola.');
        }

        if (Array.isArray(updatePayload.tutors) && updatePayload.tutors.length > 0) {
            await this._syncTutorStudentLinks(updatePayload.tutors, updatedStudent._id);
        }

        return updatedStudent;
    }

    /**
     * Deleta aluno.
     * [ALTERAÇÃO] Adicionado 'user' e 'reason'
     */
    async deleteStudent(id, schoolId, user, reason) {
        // Primeiro buscamos para garantir que existe e pegar IDs dos tutores
        const student = await Student.findOne({ _id: id, school_id: schoolId });
        
        if (!student) throw new Error('Aluno não encontrado.');
        
        const tutorIds = student.tutors.map(t => t.tutorId);
        
        // [AUDITORIA] Usamos findOneAndDelete passando as options
        // O Plugin deve ter um hook para 'findOneAndDelete' para isso funcionar 100%
        // Se o plugin só tiver 'save' e 'update', o delete não gera log automático.
        // Assumindo que adicionamos o hook de delete no plugin:
        await Student.findOneAndDelete(
            { _id: id }, 
            { user: user, reason: reason } // Passa contexto
        ); 
        
        await Tutor.updateMany(
            { _id: { $in: tutorIds } },
            { $pull: { students: student._id } } 
        );
        return student; 
    }

    // --- MÉTODOS AUXILIARES ---

    async getUpcomingBirthdays(schoolId) {
        // ... (Código mantido idêntico - Apenas leitura) ...
        const { ObjectId } = mongoose.Types; 
        try {
            const sortedStudentInfos = await Student.aggregate([
                { $match: { school_id: new ObjectId(schoolId) } },
                { $addFields: { "__todayDayOfYear": { $dayOfYear: new Date() }, "__birthdayDayOfYear": { $dayOfYear: "$birthDate" } } },
                { $addFields: { "__diff": { $subtract: [ "$__birthdayDayOfYear", "$__todayDayOfYear" ] } } },
                { $addFields: { "sortKey": { $cond: { if: { $lt: ["$__diff", 0] }, then: { $add: ["$__diff", 366] }, else: "$__diff" } } } },
                { $sort: { "sortKey": 1 } },
                { $project: { _id: 1 } } 
            ]);

            const sortedIds = sortedStudentInfos.map(info => info._id);
            if (sortedIds.length === 0) return []; 

            const populatedStudents = await Student.find({ 
                _id: { $in: sortedIds },
                school_id: schoolId 
            })
            .select('-profilePicture.data') 
            .populate(tutorPopulation); 

            const studentMap = new Map(populatedStudents.map(student => [student._id.toString(), student]));
            return sortedIds.map(id => studentMap.get(id.toString())).filter(student => student != null); 
        } catch (error) {
            throw new Error('Erro ao processar busca de aniversariantes');
        }
    }

    /**
     * Atualiza relacionamento com tutor.
     * [ALTERAÇÃO] Adicionado 'user' para logar a mudança no histórico
     */
    async updateTutorRelationship(studentId, tutorId, newRelationship, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        const tutorLink = student.tutors.find(t => t.tutorId.toString() === tutorId);
        if (!tutorLink) throw new Error('Vínculo não encontrado.');

        tutorLink.relationship = newRelationship;

        // [AUDITORIA] Injeta user antes de salvar
        if (user) student._user = user;
        
        // Como estamos usando .save(), o plugin vai comparar o student carregado com o novo
        // Atenção: O plugin precisa da lógica de "pre('save')" ou "pre('validate')" correta 
        // para detectar mudanças em subdocumentos arrays, o que pode ser complexo.
        // Mas o log de "UPDATE" na entidade Student será gerado.
        await student.save();

        // ... (restante da lógica de retorno mantida)
        const studentObj = student.toObject();
        if(studentObj.profilePicture) delete studentObj.profilePicture.data;
        
        // Re-popula para retorno
        await student.populate(tutorPopulation);
        
        const populatedTutors = student.tutors.map(link => ({
            relationship: link.relationship,
            tutorInfo: link.tutorId 
        }));
        
        const updatedPopulatedLink = populatedTutors.find(
             (t) => t.tutorInfo._id.toString() === tutorId
        );

        return { updatedLink: updatedPopulatedLink, student: studentObj }; 
    }

    // [ALTERAÇÃO] user adicionado em todos os métodos de histórico
    async addHistoryRecord(studentId, recordData, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        student.academicHistory.push(recordData);
        
        if (user) student._user = user; // Auditoria
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }

    async updateHistoryRecord(studentId, recordId, updatedData, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        const record = student.academicHistory.id(recordId);
        if (!record) throw new Error('Registro não encontrado.');

        Object.assign(record, updatedData);
        
        if (user) student._user = user; // Auditoria
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }

    async deleteHistoryRecord(studentId, recordId, schoolId, user) {
        const student = await Student.findOne({ _id: studentId, school_id: schoolId });
        if (!student) throw new Error('Aluno não encontrado.');

        student.academicHistory.pull(recordId);
        
        if (user) student._user = user; // Auditoria
        await student.save();
        
        const result = student.toObject();
        if(result.profilePicture) delete result.profilePicture.data;
        return result; 
    }
    
    // Contagem (Leitura apenas, sem user)
    async getCountByAgeAndBirthday(minAge, maxAge, birthdayMonth, schoolId) {
       // ... (Código mantido idêntico) ...
       const today = new Date();
       today.setHours(0, 0, 0, 0); 
       const latestBirthDate = new Date(today.getFullYear() - minAge, today.getMonth(), today.getDate());
       const earliestBirthDate = new Date(today.getFullYear() - (maxAge + 1), today.getMonth(), today.getDate() + 1);
   
       const query = {
           school_id: schoolId,
           birthDate: { $gte: earliestBirthDate, $lte: latestBirthDate },
           isActive: true, 
           $expr: { $eq: [{ $month: '$birthDate' }, birthdayMonth] },
       };
       return await Student.countDocuments(query);
    }
}

module.exports = new StudentService();
