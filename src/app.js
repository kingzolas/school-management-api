const express = require('express');
const cors = require('cors');
const userRoutes = require('./api/routes/user.routes');
const authRoutes = require('./api/routes/auth.routes'); 
const tutorRoutes = require('./api/routes/tutor.routes');
const studentRoutes = require('./api/routes/student.routes');
const classRoutes = require('./api/routes/class.routes');
const enrollmentRoutes = require('./api/routes/enrollment.routes');
const subjectRoutes = require('./api/routes/subject.routes');
const horarioRoutes = require('./api/routes/horario.routes');
const eventoRoutes = require('./api/routes/evento.routes');

// --- Importar nossas novas rotas (com os nomes corretos) ---
const schoolYearRoutes = require('./api/routes/schoolyear.routes');
const periodoRoutes = require('./api/routes/periodo.routes');
const cargaHorariaRoutes = require('./api/routes/cargaHoraria.routes'); // [NOVO]
const courseLoadRoutes = require('./api/routes/courseLoad.routes');
const invoiceRoutes = require('./api/routes/invoice.routes.js');
const webhookRoutes = require('./api/routes/webhook.routes.js');
const assistantRoutes = require('./api/routes/assistant.routes.js');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- Rota de Teste ---
app.get('/', (req, res) => {
    res.status(200).json({
        message: '🚀 API do Sistema de Gerenciamento Escolar no ar!',
        status: 'OK'
    });
});

// --- Rotas da API ---
app.use('/api/students', studentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tutors', tutorRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/subjects', subjectRoutes); // [CORRIGIDO] Estava como 'app.se'
app.use('/api/horarios', horarioRoutes);
app.use('/api/eventos', eventoRoutes);

// [NOVAS ROTAS] Registrando as novas rotas em inglês
app.use('/api/school-years', schoolYearRoutes); // Rota ex: /api/school-years
app.use('/api/terms', periodoRoutes);           // Rota ex: /api/terms
app.use('/api/carga-horaria', cargaHorariaRoutes); // [NOVO]
app.use('/api/course-loads', courseLoadRoutes); // Registra as novas rotas

app.use('/api/invoices', invoiceRoutes);
app.use('/api/webhook', webhookRoutes); // Rota pública para o gateway
app.use('/api/assistant', assistantRoutes); // Prefixo da API do assistente

module.exports = app;