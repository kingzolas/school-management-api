# API Contract - Ensino Tecnico / Jovem Aprendiz

Contrato do estado final atual da API para orientar o Flutter sem inferir regras erradas.

## Arquivos do backend envolvidos

### Ajustados/criados na base da API

- `src/api/models/school.model.js`
- `src/app.js`
- `src/api/models/company.model.js`
- `src/api/services/company.service.js`
- `src/api/controllers/company.controller.js`
- `src/api/routes/company.routes.js`
- `src/api/models/technicalProgram.model.js`
- `src/api/services/technicalProgram.service.js`
- `src/api/controllers/technicalProgram.controller.js`
- `src/api/routes/technicalProgram.routes.js`
- `src/api/models/technicalProgramModule.model.js`
- `src/api/services/technicalProgramModule.service.js`
- `src/api/controllers/technicalProgramModule.controller.js`
- `src/api/routes/technicalProgramModule.routes.js`
- `src/api/models/technicalEnrollment.model.js`
- `src/api/services/technicalEnrollment.service.js`
- `src/api/controllers/technicalEnrollment.controller.js`
- `src/api/routes/technicalEnrollment.routes.js`
- `src/api/models/technicalModuleRecord.model.js`
- `src/api/services/technicalModuleRecord.service.js`
- `src/api/controllers/technicalModuleRecord.controller.js`
- `src/api/routes/technicalModuleRecord.routes.js`
- `src/api/models/technicalClassMovement.model.js`
- `src/api/services/technicalClassMovement.service.js`
- `src/api/controllers/technicalClassMovement.controller.js`
- `src/api/routes/technicalClassMovement.routes.js`

## Atualizacoes desta rodada

- `technicalProgram` permanece como curso/programa macro
- `technicalProgramModule` permanece como modulo/disciplinas do curso
- `TechnicalEnrollment` agora pode nascer sem turma
- `currentClassId` e opcional na criacao
- `Company` ganhou `contactPerson`
- o front precisa tratar `Student.address`/`Company.address` como `cep` e `School.address` como `zipCode`

## School

### Campo novo

- `educationModel`: `regular` | `technical_apprenticeship`
- default: `regular`

### Contrato

- `POST /api/schools` aceita `educationModel`
- `PATCH /api/schools/:id` aceita `educationModel`
- o restante do CRUD de escola permanece igual

## Company

### Modelo final

- `name`: string, required
- `legalName`: string, optional
- `cnpj`: string, required
- `stateRegistration`: string, optional
- `municipalRegistration`: string, optional
- `contactPerson`: object, optional
- `contactPhone`: string, optional
- `contactEmail`: string, optional
- `address`: `addressSchema`, required
- `logo`: subdocumento binario, optional
- `logoUrl`: string, optional/manual
- `school_id`: ObjectId ref `School`, required
- `status`: `Ativa` | `Inativa`, default `Ativa`

### `contactPerson`

- `fullName`: string, required quando o objeto existe
- `jobTitle`: string, required quando o objeto existe
- `phone`: string, optional
- `email`: string, optional

### Semantica

- `contactPerson` e o representante ou contato principal da empresa
- `contactPhone` e `contactEmail` continuam como contatos gerais
- `logoUrl` nao e gerado automaticamente pelo backend
- a imagem canonica e a binaria servida pela rota de logo

### Rotas

- `POST /api/companies`
- `GET /api/companies`
- `GET /api/companies/:id`
- `GET /api/companies/:id/logo`
- `PATCH /api/companies/:id`
- `PATCH /api/companies/:id/inactivate`

### Metodo e transporte

- `POST`, `PATCH`, `GET`
- `POST` e `PATCH` aceitam JSON puro ou `multipart/form-data`
- o arquivo de logo deve ir no campo `logo`
- o upload de logo usa limite de 5 MB
- `address` e `contactPerson` podem vir como objeto JSON, string JSON ou campos aninhados no form-data

### Response shape

- `GET /api/companies` e `GET /api/companies/:id` retornam documentos sem `logo.data`
- se houver logo, a metadata pode aparecer como `logo.contentType`
- `logo.data` nunca deve chegar ao front
- `GET /api/companies/:id/logo` retorna binario com `Content-Type` da imagem

### Regras

- `cnpj` unico por escola
- `name` obrigatorio
- `address` obrigatorio
- `contactPerson.fullName` e `contactPerson.jobTitle` obrigatorios quando `contactPerson` for enviado

### Exemplo de request

```json
{
  "name": "Metal Sul",
  "legalName": "Metal Sul Industria e Comercio LTDA",
  "cnpj": "11.222.333/0001-44",
  "stateRegistration": "123456789",
  "municipalRegistration": "987654321",
  "contactPerson": {
    "fullName": "Maria Souza",
    "jobTitle": "Coordenadora de RH",
    "phone": "(11) 99999-9999",
    "email": "maria.souza@metalsul.com"
  },
  "contactPhone": "(11) 3333-4444",
  "contactEmail": "contato@metalsul.com",
  "address": {
    "street": "Av. Industrial",
    "neighborhood": "Distrito Industrial",
    "number": "100",
    "block": "",
    "lot": "",
    "cep": "01000-000",
    "city": "Sao Paulo",
    "state": "SP"
  }
}
```

### Exemplo de response

```json
{
  "_id": "66f000000000000000000010",
  "name": "Metal Sul",
  "legalName": "Metal Sul Industria e Comercio LTDA",
  "cnpj": "11.222.333/0001-44",
  "stateRegistration": "123456789",
  "municipalRegistration": "987654321",
  "contactPerson": {
    "fullName": "Maria Souza",
    "jobTitle": "Coordenadora de RH",
    "phone": "(11) 99999-9999",
    "email": "maria.souza@metalsul.com"
  },
  "contactPhone": "(11) 3333-4444",
  "contactEmail": "contato@metalsul.com",
  "address": {
    "street": "Av. Industrial",
    "neighborhood": "Distrito Industrial",
    "number": "100",
    "block": "",
    "lot": "",
    "cep": "01000-000",
    "city": "Sao Paulo",
    "state": "SP"
  },
  "school_id": "66f000000000000000000001",
  "status": "Ativa",
  "createdAt": "2026-03-26T12:00:00.000Z",
  "updatedAt": "2026-03-26T12:00:00.000Z"
}
```

## TechnicalProgram

### Interpretacao correta

`TechnicalProgram` e o curso/programa macro do dominio tecnico.

### Modelo

- `name`: string, required
- `description`: string, optional
- `totalWorkloadHours`: number, required
- `school_id`: ObjectId ref `School`, required
- `status`: `Ativo` | `Inativo`, default `Ativo`

### Rotas

- `POST /api/technical-programs`
- `GET /api/technical-programs`
- `GET /api/technical-programs/:id`
- `PATCH /api/technical-programs/:id`
- `PATCH /api/technical-programs/:id/inactivate`

### Regras

- `name` unico por escola
- `totalWorkloadHours` nao pode ser negativo

### Exemplo de request

```json
{
  "name": "Tecnico em Logistica",
  "description": "Programa de formacao tecnica para jovens aprendizes.",
  "totalWorkloadHours": 1200
}
```

### Exemplo de response

```json
{
  "_id": "66f000000000000000000020",
  "name": "Tecnico em Logistica",
  "description": "Programa de formacao tecnica para jovens aprendizes.",
  "totalWorkloadHours": 1200,
  "school_id": "66f000000000000000000001",
  "status": "Ativo"
}
```

## TechnicalProgramModule

### Interpretacao correta

`TechnicalProgramModule` e o modulo/disciplinas dentro do curso macro.

### Modelo

- `technicalProgramId`: ObjectId ref `TechnicalProgram`, required
- `subjectId`: ObjectId ref `Subject`, optional, default `null`
- `name`: string, required
- `description`: string, optional
- `moduleOrder`: number, required
- `workloadHours`: number, required
- `school_id`: ObjectId ref `School`, required
- `status`: `Ativo` | `Inativo`, default `Ativo`

### Rotas

- `POST /api/technical-program-modules`
- `GET /api/technical-program-modules`
- `GET /api/technical-program-modules/:id`
- `PATCH /api/technical-program-modules/:id`
- `PATCH /api/technical-program-modules/:id/inactivate`

### Regras

- `moduleOrder` unico por programa e escola
- `subjectId` e opcional
- o front nao deve tratar `Subject` como curso macro

### Exemplo de request

```json
{
  "technicalProgramId": "66f000000000000000000020",
  "subjectId": "66f000000000000000000030",
  "name": "Operacoes Logisticas",
  "description": "Base operacional do modulo.",
  "moduleOrder": 1,
  "workloadHours": 120
}
```

### Exemplo de response

```json
{
  "_id": "66f000000000000000000021",
  "technicalProgramId": "66f000000000000000000020",
  "subjectId": "66f000000000000000000030",
  "name": "Operacoes Logisticas",
  "description": "Base operacional do modulo.",
  "moduleOrder": 1,
  "workloadHours": 120,
  "school_id": "66f000000000000000000001",
  "status": "Ativo"
}
```

## TechnicalEnrollment

### Interpretacao correta

`TechnicalEnrollment` e o vinculo academico individual do participante com empresa e curso.

### Modelo final

- `studentId`: ObjectId ref `Student`, required
- `companyId`: ObjectId ref `Company`, required
- `technicalProgramId`: ObjectId ref `TechnicalProgram`, required
- `currentClassId`: ObjectId ref `Class`, optional, default `null`
- `enrollmentDate`: Date, default now
- `status`: `Pendente` | `Ativa` | `Concluída` | `Cancelada`, default `Pendente`
- `notes`: string, optional
- `school_id`: ObjectId ref `School`, required

### Rotas

- `POST /api/technical-enrollments`
- `GET /api/technical-enrollments`
- `GET /api/technical-enrollments/:id`
- `PATCH /api/technical-enrollments/:id`

### Regras

- o participante pode ser criado e vinculado a empresa + curso sem turma
- `currentClassId` e opcional na criacao
- se `currentClassId` nao vier e `status` nao for enviado, o backend grava `Pendente`
- se `currentClassId` vier e `status` nao for enviado, o backend grava `Ativa`
- o mesmo participante pode fazer varios cursos via varios `TechnicalEnrollment`
- a unicidade continua sendo `studentId + technicalProgramId + school_id`
- o mesmo participante nao pode repetir o mesmo programa por esse mesmo endpoint ainda

### Parametros e body

- `POST` aceita `studentId`, `companyId`, `technicalProgramId`, `currentClassId` opcional, `notes` e `status`
- `PATCH` aceita qualquer campo editavel do schema, inclusive `currentClassId`
- o backend atualmente aceita `currentClassId: null` em `PATCH`, mas o front nao deve criar uma UX de "limpar turma" sem validacao de negocio

### Response shape

- respostas populadas para `studentId`, `companyId`, `technicalProgramId` e `currentClassId`
- `currentClassId` pode vir `null`
- os identificadores podem vir como objeto populado ou, em outros endpoints, como string

### Regras de validacao

- participante, empresa, curso e turma eventual precisam pertencer a mesma escola
- nao pode existir duplicidade do mesmo participante no mesmo curso

### Exemplo de request sem turma

```json
{
  "studentId": "66f000000000000000000040",
  "companyId": "66f000000000000000000010",
  "technicalProgramId": "66f000000000000000000020",
  "notes": "Matricula inicial sem turma definida."
}
```

### Exemplo de response sem turma

```json
{
  "_id": "66f000000000000000000060",
  "studentId": {
    "_id": "66f000000000000000000040",
    "fullName": "Joao da Silva",
    "birthDate": "2008-04-10T00:00:00.000Z",
    "cpf": "123.456.789-00"
  },
  "companyId": {
    "_id": "66f000000000000000000010",
    "name": "Metal Sul",
    "legalName": "Metal Sul Industria e Comercio LTDA",
    "cnpj": "11.222.333/0001-44"
  },
  "technicalProgramId": {
    "_id": "66f000000000000000000020",
    "name": "Tecnico em Logistica",
    "totalWorkloadHours": 1200
  },
  "currentClassId": null,
  "enrollmentDate": "2026-03-26T12:00:00.000Z",
  "status": "Pendente",
  "notes": "Matricula inicial sem turma definida."
}
```

## TechnicalModuleRecord

### Interpretacao correta

`TechnicalModuleRecord` registra o historico por modulo sem sobrescrever tentativas anteriores.

### Modelo

- `technicalEnrollmentId`: ObjectId ref `TechnicalEnrollment`, required
- `technicalProgramModuleId`: ObjectId ref `TechnicalProgramModule`, required
- `attemptNumber`: number, required e calculado pelo backend
- `moduleWorkloadHours`: number, required e calculado pelo backend
- `completedHours`: number, default `0`
- `status`: `Pendente` | `Em andamento` | `Concluído` | `Reprovado` | `Repetindo`, default `Pendente`
- `startedAt`: Date, optional
- `finishedAt`: Date, optional
- `notes`: string, optional
- `school_id`: ObjectId ref `School`, required

### Rotas

- `POST /api/technical-module-records`
- `GET /api/technical-module-records`
- `GET /api/technical-module-records/:id`
- `PATCH /api/technical-module-records/:id`

### Regras

- o backend calcula `attemptNumber`
- o backend fixa `moduleWorkloadHours` a partir do modulo
- `completedHours` nao pode ser negativa nem maior que a carga do modulo
- `Concluído` exige carga horaria completa

### Exemplo de request

```json
{
  "technicalEnrollmentId": "66f000000000000000000060",
  "technicalProgramModuleId": "66f000000000000000000021",
  "status": "Em andamento",
  "completedHours": 40,
  "notes": "Aluno segue cursando o modulo."
}
```

### Exemplo de response

```json
{
  "_id": "66f000000000000000000070",
  "technicalEnrollmentId": {
    "_id": "66f000000000000000000060",
    "studentId": {
      "_id": "66f000000000000000000040",
      "fullName": "Joao da Silva"
    },
    "companyId": {
      "_id": "66f000000000000000000010",
      "name": "Metal Sul"
    },
    "technicalProgramId": {
      "_id": "66f000000000000000000020",
      "name": "Tecnico em Logistica"
    },
    "currentClassId": null
  },
  "technicalProgramModuleId": {
    "_id": "66f000000000000000000021",
    "name": "Operacoes Logisticas",
    "moduleOrder": 1,
    "workloadHours": 120,
    "subjectId": {
      "_id": "66f000000000000000000030",
      "name": "Logistica"
    }
  },
  "attemptNumber": 1,
  "moduleWorkloadHours": 120,
  "completedHours": 40,
  "status": "Em andamento",
  "startedAt": "2026-03-26T12:00:00.000Z",
  "finishedAt": null,
  "notes": "Aluno segue cursando o modulo."
}
```

## TechnicalClassMovement

### Interpretacao correta

`TechnicalClassMovement` registra o historico de trocas de turma do participante tecnico.

### Modelo

- `technicalEnrollmentId`: ObjectId ref `TechnicalEnrollment`, required
- `fromClassId`: ObjectId ref `Class`, required
- `toClassId`: ObjectId ref `Class`, required
- `movedAt`: Date, default now
- `reason`: string, optional
- `notes`: string, optional
- `performedByUserId`: ObjectId ref `User`, optional e preenchido pelo backend
- `school_id`: ObjectId ref `School`, required

### Rotas

- `POST /api/technical-class-movements`
- `GET /api/technical-class-movements`
- `GET /api/technical-class-movements/:id`

### Regras

- o movimento exige turma de origem no estado atual da matricula
- o backend atualiza `TechnicalEnrollment.currentClassId` no mesmo fluxo
- o historico nao e apagado
- se a atualizacao da matricula falhar, o movimento e removido por rollback manual

### Exemplo de request

```json
{
  "technicalEnrollmentId": "66f000000000000000000060",
  "toClassId": "66f000000000000000000051",
  "reason": "Mudanca de turno solicitada pela coordenacao",
  "notes": "Migracao da manha para a tarde"
}
```

### Exemplo de response

```json
{
  "_id": "66f000000000000000000080",
  "technicalEnrollmentId": {
    "_id": "66f000000000000000000060",
    "studentId": {
      "_id": "66f000000000000000000040",
      "fullName": "Joao da Silva"
    },
    "companyId": {
      "_id": "66f000000000000000000010",
      "name": "Metal Sul"
    },
    "technicalProgramId": {
      "_id": "66f000000000000000000020",
      "name": "Tecnico em Logistica"
    },
    "currentClassId": {
      "_id": "66f000000000000000000051",
      "name": "Turma 2026 Tarde"
    }
  },
  "fromClassId": {
    "_id": "66f000000000000000000050",
    "name": "Turma 2026 Manha"
  },
  "toClassId": {
    "_id": "66f000000000000000000051",
    "name": "Turma 2026 Tarde"
  },
  "movedAt": "2026-03-26T13:00:00.000Z",
  "reason": "Mudanca de turno solicitada pela coordenacao",
  "notes": "Migracao da manha para a tarde",
  "performedByUserId": {
    "_id": "66f000000000000000000090",
    "fullName": "Maria Coordenacao",
    "username": "maria.coord",
    "roles": ["Coordenador"]
  }
}
```

## Relações principais

- `School` 1:N `Company`
- `School` 1:N `TechnicalProgram`
- `School` 1:N `TechnicalProgramModule`
- `School` 1:N `TechnicalEnrollment`
- `School` 1:N `TechnicalModuleRecord`
- `School` 1:N `TechnicalClassMovement`
- `Company` 1:N `TechnicalEnrollment`
- `TechnicalProgram` 1:N `TechnicalProgramModule`
- `TechnicalProgram` 1:N `TechnicalEnrollment`
- `TechnicalEnrollment` N:1 `Student`
- `TechnicalEnrollment` N:1 `Class` via `currentClassId`
- `TechnicalModuleRecord` N:1 `TechnicalEnrollment`
- `TechnicalModuleRecord` N:1 `TechnicalProgramModule`
- `TechnicalClassMovement` N:1 `TechnicalEnrollment`
- `TechnicalClassMovement` N:1 `Class` via `fromClassId` e `toClassId`
- `TechnicalClassMovement` N:1 `User` via `performedByUserId`

## Regras de validacao gerais

- `school_id` nao deve ser enviado pelo cliente
- o backend injeta `school_id` com base em `req.user.school_id`
- todas as rotas tecnicas usam `authMiddleware.verifyToken`
- referencias sempre precisam pertencer a mesma escola
- `cnpj` e unico por escola
- `TechnicalProgram.name` e unico por escola
- `TechnicalProgramModule.moduleOrder` e unico por programa e escola
- `TechnicalEnrollment` bloqueia o mesmo `studentId + technicalProgramId + school_id`
- `TechnicalModuleRecord` bloqueia o mesmo `technicalEnrollmentId + technicalProgramModuleId + attemptNumber + school_id`
- `TechnicalClassMovement` recusa origem igual ao destino

## Pontos que o front precisa respeitar agora

- `TechnicalProgram` nao e disciplina
- `TechnicalProgramModule` nao e curso separado
- `TechnicalEnrollment.currentClassId` pode ser `null`
- `Company.contactPerson` nao e `Tutor`
- `Company.logoUrl` nao e auto-gerado
- `Student.address`/`Company.address` usam `cep`
- `School.address` usa `zipCode`

## Erros esperados

- `400`: erro de validacao Mongoose ou regra de negocio
- `403`: usuario sem `req.user.school_id`
- `404`: entidade nao encontrada ou nao pertencente a escola
- `409`: conflito de unicidade ou duplicidade
- `500`: erro nao tratado

