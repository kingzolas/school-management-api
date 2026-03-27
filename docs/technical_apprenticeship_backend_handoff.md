# Handoff Backend - Ensino Tecnico / Jovem Aprendiz

Documento de contexto do estado final atual da API para orientar o projeto Flutter sem perder a semantica do dominio tecnico.

## O que mudou desde a primeira versao do handoff

- `technicalProgram` foi confirmado como o curso/programa macro
- `technicalProgramModule` foi confirmado como modulo/disciplinas dentro do curso
- `TechnicalEnrollment` deixou de exigir turma no cadastro inicial
- `currentClassId` passou a ser opcional na criacao do vinculo tecnico
- a empresa ganhou `contactPerson` como contato/representante principal
- a leitura do legado foi detalhada em `technical_apprenticeship_legacy_reuse.md`
- a regra de multiplos cursos por participante passou a ser interpretada como varios `TechnicalEnrollment`

## Contexto de negocio

O Academy Hub continua atendendo o ensino regular e agora suporta o dominio tecnico / jovem aprendiz por meio de:

- `educationModel = regular`
- `educationModel = technical_apprenticeship`

No tecnico, a empresa e a entidade institucional central. O participante continua sendo a mesma base de pessoa/aluno, mas a jornada academica e modelada por vinculos relacionais novos.

## Decisoes finais de semantica

### `technicalProgram`

Permanece como o curso/programa macro do dominio tecnico.

Nao foi criado um `course` paralelo porque isso duplicaria o conceito sem ganho real.

### `technicalProgramModule`

Permanece como o modulo/disciplinas dentro do curso.

Ele guarda ordem, carga horaria e, quando fizer sentido, referencia opcional para `Subject`.

### `TechnicalEnrollment`

E o vinculo academico individual do participante.

O fluxo atual permite:

- criar o participante
- vincular empresa
- vincular curso
- alocar turma depois

O `currentClassId` e opcional no cadastro inicial.

### Multiplos cursos por participante

A regra adotada e:

- um participante pode ter varios cursos
- cada curso gera um `TechnicalEnrollment` proprio
- a unicidade continua sendo `studentId + technicalProgramId + school_id`

Ou seja, o participante pode ter varias matriculas tecnicas, uma por programa, sem poluir `Student`.

### Empresa

A empresa agora e um dominio proprio, com:

- `contactPerson` como representante ou contato principal
- `contactPhone` e `contactEmail` como contatos gerais
- suporte a logo binaria

## Diferenca entre regular e tecnico

### Ensino regular

- aluno vinculado a tutor/responsavel
- financeiro normalmente vinculado ao tutor
- progresso muito ligado a turma, serie e periodo

### Ensino tecnico / jovem aprendiz

- participante vinculado a empresa
- empresa e a entidade institucional central
- turma organiza a operacao, mas nao define sozinha a jornada
- progresso individual e historico por modulo
- o participante pode mudar de turma ao longo do percurso
- o participante pode cursar mais de um programa tecnico

## O que foi reaproveitado

- `School`
- `Student`
- `Subject`
- `Class`
- `User`
- `addressSchema`
- isolamento por `school_id`
- rotas protegidas com `authMiddleware.verifyToken`

## O que nao foi reaproveitado como nucleo do tecnico

- `Tutor`
- `ReportCard`
- `Grade`
- `Periodo`
- `Enrollment` regular como espinha do tecnico
- qualquer regra de progresso baseada apenas em turma/serie/bimestre

## Resumo dos dominios

### School

- define a operacao da escola via `educationModel`
- valores: `regular` e `technical_apprenticeship`

### Company

- representa a empresa parceira
- possui `contactPerson` como contato principal
- mantem contatos gerais da empresa
- suporta logo binaria

### TechnicalProgram

- representa o curso/programa tecnico macro
- guarda nome, descricao e carga horaria total

### TechnicalProgramModule

- representa os modulos/disciplinas do programa
- guarda ordem e carga horaria
- pode referenciar `Subject`

### TechnicalEnrollment

- representa o vinculo entre `Student`, `Company` e `TechnicalProgram`
- `currentClassId` e opcional na criacao
- a turma pode ser definida depois
- o status inicial pode ser `Pendente`

### TechnicalModuleRecord

- representa o historico real por modulo
- registra tentativas sem sobrescrever o historico anterior

### TechnicalClassMovement

- representa o historico de trocas de turma
- registra origem, destino, motivo e executor
- atualiza a turma atual da matricula sem apagar o passado

## O que continua importante para o front

- `technicalProgram` nao e uma disciplina
- `technicalProgramModule` nao e um curso separado
- `TechnicalEnrollment.currentClassId` pode vir `null`
- `company.contactPerson` nao e `Tutor`
- `Student.classId` nao deve ser usado como espinha do tecnico
- `Student.healthInfo` continua sendo contexto de apoio, nao regra de progresso
- `Student.address` e `Company.address` usam `cep`; `School.address` usa `zipCode`

## Riscos, pendencias e limitacoes

- nao existe gating por `educationModel` para bloquear rotas tecnicas em escolas regulares
- nao existe consolidacao de progresso individual em uma unica rota ainda
- nao existe historico de trocas de empresa
- o backend nao gera `logoUrl` automaticamente para empresa; a imagem canonica e a rota `GET /api/companies/:id/logo`
- o movimento de turma ainda usa rollback manual, nao transacao Mongo formal
- a regra atual bloqueia repeticao do mesmo par `student + technicalProgram`
- a limpeza de turma em `PATCH /api/technical-enrollments/:id` ainda e uma borda operacional que o front nao deve inventar sem validacao de negocio

## Documento complementar

Para a leitura pratica do legado reutilizavel pelo front, ver:

- `docs/technical_apprenticeship_legacy_reuse.md`

