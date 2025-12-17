// src/api/helpers/auditLog.plugin.js
const AuditLog = require('../api/models/auditLog.model');
const mongoose = require('mongoose');

const auditLogPlugin = function(schema, options) {
  
  // Helper para extrair ID do usuário, não importa como ele venha
  const getActorId = (userObj) => {
    if (!userObj) return null;
    // Se já for um ID (String ou ObjectId), retorna ele mesmo
    if (typeof userObj === 'string' || userObj instanceof mongoose.Types.ObjectId) {
        return userObj;
    }
    // Se for objeto (req.user), tenta pegar ._id ou .id
    if (typeof userObj === 'object') {
        return userObj._id || userObj.id || null;
    }
    return null;
  };

  // 1. Hook para quando criar algo novo (CREATE)
  schema.post('save', async function(doc) {
    if (!doc._wasNew) return; 

    // [CORREÇÃO] Usamos o helper para limpar o ID
    const actor = getActorId(doc._user); 
    const school = doc.school || doc.school_id || doc._school || null; 

    if (actor && school) {
      try {
        await AuditLog.create({
          school: school,
          actor: actor,
          entity: options.entityName || 'Unknown',
          entityId: doc._id,
          action: 'CREATE',
          changes: { current: doc.toObject() }
        });
      } catch (err) {
        console.error('❌ [AuditLog] Falha ao criar log de CREATE:', err.message);
      }
    }
  });

  // 2. Hook PRE para capturar o estado anterior (UPDATE)
  schema.pre('findOneAndUpdate', async function(next) {
    try {
      this._original = await this.model.findOne(this.getQuery());
    } catch (e) {
      console.error('Erro ao buscar original para auditoria:', e);
    }
    next();
  });

  // 3. Hook POST para salvar o log (UPDATE)
  schema.post('findOneAndUpdate', async function(doc) {
    if (!this._original || !doc) return;

    // [CORREÇÃO] Usamos o helper aqui também
    const rawUser = this.options.user || null;
    const actor = getActorId(rawUser);
    
    const reason = this.options.reason || null;
    const schoolId = doc.school || doc.school_id;

    if (actor && schoolId) {
      try {
        await AuditLog.create({
          school: schoolId, 
          actor: actor, 
          entity: options.entityName,
          entityId: doc._id,
          action: 'UPDATE',
          reason: reason,
          changes: {
            previous: this._original.toObject(),
            current: doc.toObject()
          }
        });
        // Sucesso silencioso (não polui o log se der certo)
      } catch (err) {
        console.error(`❌ [AuditLog] Erro ao salvar log de UPDATE em ${options.entityName}:`, err.message);
      }
    } else {
        // Debug só aparece se faltar dados
        if(!actor && rawUser) console.warn('⚠️ [AuditLog] Falha ao extrair ID do usuário:', rawUser);
    }
  });
};

module.exports = auditLogPlugin;