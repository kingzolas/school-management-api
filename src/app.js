const express = require('express');
const cors = require('cors');

// --- Rotas Legadas/Existentes ---
const userRoutes = require('./api/routes/user.routes');
const authRoutes = require('./api/routes/auth.routes'); // Auth Administrativo (Staff)
const tutorRoutes = require('./api/routes/tutor.routes');
const studentRoutes = require('./api/routes/student.routes');
const classRoutes = require('./api/routes/class.routes');
const enrollmentRoutes = require('./api/routes/enrollment.routes');
const subjectRoutes = require('./api/routes/subject.routes');
const horarioRoutes = require('./api/routes/horario.routes');
const eventoRoutes = require('./api/routes/evento.routes');
const schoolYearRoutes = require('./api/routes/schoolyear.routes');
const periodoRoutes = require('./api/routes/periodo.routes');
const cargaHorariaRoutes = require('./api/routes/cargaHoraria.routes');
const courseLoadRoutes = require('./api/routes/courseLoad.routes');
const invoiceRoutes = require('./api/routes/invoice.routes.js');
const webhookRoutes = require('./api/routes/webhook.routes.js');
const assistantRoutes = require('./api/routes/assistant.routes.js');
const negotiationRoutes = require('./api/routes/negotiation.routes.js'); 
const whatsappRoutes = require('./api/routes/whatsapp.routes');
const schoolRoutes = require('./api/routes/school.routes.js');

// ===================================================================
// [NOVAS IMPORTAÇÕES] Módulo de Avaliações e Auth Aluno
// ===================================================================
const authStudentRoutes = require('./api/routes/authStudent.routes.js');
const assessmentRoutes = require('./api/routes/assessment.routes.js');
const assessmentAttemptRoutes = require('./api/routes/assessmentAttempt.routes.js');
// ===================================================================

const app = express();

// Configuração CORS (Pode precisar ajustar para aceitar seu App Flutter)
app.use(cors()); 

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Rota de Health Check ---
app.get('/', (req, res) => {
  res.status(200).json({
    message: '🚀 API do Sistema de Gerenciamento Escolar no ar!',
    status: 'OK'
  });
});

// --- Registro das Rotas ---

// Autenticação
app.use('/api/auth', authRoutes);                 // Login Staff/Admin
app.use('/api/auth/student', authStudentRoutes);  // [NOVO] Login Aluno

// Funcionalidades Principais
app.use('/api/schools', schoolRoutes);
app.use('/api/students', studentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/tutors', tutorRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/subjects', subjectRoutes);

// Calendário e Acadêmico
app.use('/api/horarios', horarioRoutes);
app.use('/api/eventos', eventoRoutes);
app.use('/api/school-years', schoolYearRoutes);
app.use('/api/terms', periodoRoutes); 
app.use('/api/carga-horaria', cargaHorariaRoutes);
app.use('/api/course-loads', courseLoadRoutes); 

// Financeiro e Integrações
app.use('/api/invoices', invoiceRoutes);
app.use('/api/webhook', webhookRoutes); 
app.use('/api/assistant', assistantRoutes); 
app.use('/api/negotiations', negotiationRoutes);
app.use('/api/whatsapp', whatsappRoutes);

// ===================================================================
// [NOVAS ROTAS REGISTRADAS] Módulo de Avaliações
// ===================================================================
app.use('/api/assessments', assessmentRoutes); // Gestão das provas (Teacher)
app.use('/api/attempts', assessmentAttemptRoutes); // Execução das provas (Student)
// ===================================================================

module.exports = app;