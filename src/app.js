const express = require('express');
const cors = require('cors');
const userRoutes = require('./api/routes/user.routes');
const authRoutes = require('./api/routes/auth.routes'); // <-- ADICIONE
const tutorRoutes = require('./api/routes/tutor.routes');
// --- Importar nossas novas rotas ---
const studentRoutes = require('./api/routes/student.routes');
const classRoutes = require('./api/routes/class.routes');
const enrollmentRoutes = require('./api/routes/enrollment.routes');
const subjectRoutes = require('./api/routes/subject.routes');
const horarioRoutes = require('./api/routes/horario.routes');
const eventoRoutes = require('./api/routes/evento.routes');

// Vamos adicionar as rotas de usuário aqui em breve

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
// app.use('/api/users', userRoutes); // Próximo passo
app.use('/api/users', userRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/tutors', tutorRoutes);
app.use('/api/classes', classRoutes);
app.use('/api/enrollments', enrollmentRoutes);
app.use('/api/subjects', subjectRoutes);
app.use('/api/horarios', horarioRoutes);
app.use('/api/eventos', eventoRoutes);

module.exports = app;