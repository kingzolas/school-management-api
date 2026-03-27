# Legacy Reuse Guide - Ensino Tecnico / Jovem Aprendiz

Guia pratico para o projeto Flutter usar o legado com seguranca sem misturar o fluxo regular com o tecnico.

## `student`

`Student` continua sendo a base da pessoa. No tecnico, ele nao vira um novo tipo de aluno.

### Pode ser reaproveitado com seguranca

- `fullName`
- `birthDate`
- `cpf`
- `rg`
- `email`
- `phoneNumber`
- `address`
- `profilePicture`
- `healthInfo`
- `isActive`

### Nao deve ser usado como espinha do tecnico

- `tutors`
- `financialResp`
- `financialTutorId`
- `academicHistory`
- `classId` como regra de progresso

### Regra pratica

- `Student` identifica a pessoa
- a jornada tecnica real fica em `TechnicalEnrollment`
- o progresso por modulo nao deve ser inferido de `Student.classId`

## `address`

O reuso de endereco existe, mas nao e uniforme entre todos os dominios.

### Reutilizavel de verdade no tecnico

- `Student.address`
- `Company.address`

### Campos do `addressSchema`

- `street`
- `neighborhood`
- `number`
- `block`
- `lot`
- `cep`
- `city`
- `state`

### Importante

- `School.address` usa outra forma de modelagem no codigo atual, com `zipCode`
- nao trate `School.address` como se fosse o mesmo schema de `Student`/`Company`
- se o Flutter criar um componente de endereco, ele precisa aceitar ao menos dois mapeamentos: `cep` e `zipCode`

## `healthInfo`

`healthInfo` continua sendo um bloco util do `Student` para contexto de cuidado, mas nao e parte do nucleo academico.

### Como entra no tecnico

- pode ser exibido no cadastro e na consulta do participante
- ajuda a coordenação com contexto de saude, alergias e medicacao
- nao interfere em curso, modulo, turma ou empresa

### Nao deve ser tratado como

- regra de matricula
- regra de progresso
- substituto de qualquer vinculo tecnico

## `class`

`Class` continua util no tecnico, mas apenas como estrutura operacional.

### Reaproveitamento correto

- turma atual do participante
- historico de movimentacao entre turmas
- filtros de turno, ano e organizacao operacional

### Nao deve ser usado para

- definir sozinho o progresso academico
- substituir `TechnicalProgram`
- substituir `TechnicalProgramModule`
- representar a trilha macro do curso

## `subject`

`Subject` funciona como catalogo de disciplina, nao como curso macro.

### Reuso correto

- `TechnicalProgramModule.subjectId` quando fizer sentido
- catalogacao de disciplina/materia
- apoio a filtros e nomenclaturas do modulo

### Nao deve ser usado como

- curso/programa tecnico
- espinha da jornada academica
- obrigacao para todo modulo tecnico

## O que nao deve ser herdado do regular

- `Tutor` como centro do modelo tecnico
- `reportCard`
- `grade`
- `periodo`
- `enrollment` regular como espinha do tecnico
- qualquer logica que use bimestre/serie/periodo como unidade central do progresso
- a ideia de que a turma define sozinha a jornada do participante

## Resumo pratico para o front

- pessoa: `Student`
- empresa: `Company`
- curso macro: `TechnicalProgram`
- modulo/disciplinas: `TechnicalProgramModule`
- turma atual: `TechnicalEnrollment.currentClassId`
- suporte clinico/contextual: `Student.healthInfo`

