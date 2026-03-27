# Technical Apprenticeship API Contract

Contrato atual da API para o dominio tecnico / jovem aprendiz. Este documento reflete o estado final atual do backend e deve ser tratado como fonte de verdade para o Flutter.

## Regras globais

- Toda rota tecnica e autenticada.
- `school_id` sempre vem do usuario autenticado.
- O front nunca envia `school_id` manualmente.
- O dominio regular continua intacto.
- `technicalProgram` e o curso macro.
- `technicalProgramModule` e o modulo/disciplina do curso.
- `technicalProgramOffering` e a oferta concreta do curso.
- `technicalProgramOfferingModule` e a execucao do modulo dentro da oferta.
- `technicalSpace` e o recurso fisico reutilizavel.
- `TechnicalEnrollment` e o vinculo academico individual.
- `TechnicalModuleRecord` guarda o historico individual por modulo.
- `TechnicalClassMovement` continua como historico de troca de turma legado.

## Arquivos do backend que definem este dominio

| Area | Arquivos |
| --- | --- |
| Base da escola | `src/api/models/school.model.js` |
| Empresa | `src/api/models/company.model.js`, `src/api/services/company.service.js`, `src/api/controllers/company.controller.js`, `src/api/routes/company.routes.js` |
| Curso macro | `src/api/models/technicalProgram.model.js`, `src/api/services/technicalProgram.service.js`, `src/api/controllers/technicalProgram.controller.js`, `src/api/routes/technicalProgram.routes.js` |
| Modulo do curso | `src/api/models/technicalProgramModule.model.js`, `src/api/services/technicalProgramModule.service.js`, `src/api/controllers/technicalProgramModule.controller.js`, `src/api/routes/technicalProgramModule.routes.js` |
| Oferta concreta | `src/api/models/technicalProgramOffering.model.js`, `src/api/services/technicalProgramOffering.service.js`, `src/api/controllers/technicalProgramOffering.controller.js`, `src/api/routes/technicalProgramOffering.routes.js` |
| Execucao do modulo na oferta | `src/api/models/technicalProgramOfferingModule.model.js`, `src/api/services/technicalProgramOfferingModule.service.js`, `src/api/controllers/technicalProgramOfferingModule.controller.js`, `src/api/routes/technicalProgramOfferingModule.routes.js` |
| Espaco fisico | `src/api/models/technicalSpace.model.js`, `src/api/services/technicalSpace.service.js`, `src/api/controllers/technicalSpace.controller.js`, `src/api/routes/technicalSpace.routes.js` |
| Matricula tecnica | `src/api/models/technicalEnrollment.model.js`, `src/api/services/technicalEnrollment.service.js`, `src/api/controllers/technicalEnrollment.controller.js`, `src/api/routes/technicalEnrollment.routes.js` |
| Historico por modulo | `src/api/models/technicalModuleRecord.model.js`, `src/api/services/technicalModuleRecord.service.js`, `src/api/controllers/technicalModuleRecord.controller.js`, `src/api/routes/technicalModuleRecord.routes.js` |
| Movimento de turma | `src/api/models/technicalClassMovement.model.js`, `src/api/services/technicalClassMovement.service.js`, `src/api/controllers/technicalClassMovement.controller.js`, `src/api/routes/technicalClassMovement.routes.js` |
| Wiring da aplicacao | `src/app.js` |

## School

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Nome da escola |
| `educationModel` | string | no | `regular` ou `technical_apprenticeship` |
| `address.zipCode` | string | no | `School.address` usa `zipCode`, nao `cep` |

## Company

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Nome fantasia ou nome exibido |
| `legalName` | string | no | Razao social |
| `cnpj` | string | yes | Unico por escola |
| `stateRegistration` | string | no | Inscricao estadual |
| `municipalRegistration` | string | no | Inscricao municipal |
| `contactPerson` | object | no | Contato principal da empresa |
| `contactPhone` | string | no | Telefone geral da empresa |
| `contactEmail` | string | no | E-mail geral da empresa |
| `address` | object | yes | Usa `addressSchema` com `cep` |
| `logo` | binary | no | Upload via `multipart/form-data` |
| `logoUrl` | string | no | Campo manual, nao e gerado automaticamente |
| `status` | string | no | `Ativa` ou `Inativa` |

### `contactPerson`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `fullName` | string | yes when object exists | Nome do representante principal |
| `jobTitle` | string | yes when object exists | Cargo do representante principal |
| `phone` | string | no | Telefone direto |
| `email` | string | no | E-mail direto |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/companies` | Criar empresa com ou sem logo |
| `GET` | `/api/companies` | Listar empresas da escola |
| `GET` | `/api/companies/:id` | Buscar empresa por id |
| `GET` | `/api/companies/:id/logo` | Servir a logo binaria |
| `PATCH` | `/api/companies/:id` | Atualizar empresa com ou sem logo |
| `PATCH` | `/api/companies/:id/inactivate` | Inativar empresa |

### Request esperado

- O `logo` entra como arquivo em `multipart/form-data`.
- `address` e `contactPerson` podem vir como JSON string ou como campos aninhados normalizados pelo controller.
- O backend aceita `contactPerson` ausente.

### Resposta esperada

- JSON da empresa sem `logo.data`.
- `contactPerson` aparece como objeto quando existir.
- `GET /:id/logo` retorna bytes da imagem e header `Content-Type` da logo.

### Exemplo de request

```json
{
  "name": "Soulflink Ltda",
  "legalName": "Soulflink Educacao Tecnica Ltda",
  "cnpj": "12.345.678/0001-90",
  "stateRegistration": "ISENTO",
  "municipalRegistration": "123456",
  "contactPerson": {
    "fullName": "Maria Silva",
    "jobTitle": "Coordenadora Institucional",
    "phone": "(11) 99999-9999",
    "email": "maria@soulflink.com"
  },
  "contactPhone": "(11) 3333-3333",
  "contactEmail": "contato@soulflink.com",
  "address": {
    "street": "Rua Central",
    "neighborhood": "Centro",
    "number": "100",
    "cep": "01000-000",
    "city": "Sao Paulo",
    "state": "SP"
  }
}
```

### Exemplo de response

```json
{
  "_id": "66f0a1b2c3d4e5f678901234",
  "name": "Soulflink Ltda",
  "legalName": "Soulflink Educacao Tecnica Ltda",
  "cnpj": "12.345.678/0001-90",
  "contactPerson": {
    "fullName": "Maria Silva",
    "jobTitle": "Coordenadora Institucional",
    "phone": "(11) 99999-9999",
    "email": "maria@soulflink.com"
  },
  "contactPhone": "(11) 3333-3333",
  "contactEmail": "contato@soulflink.com",
  "address": {
    "street": "Rua Central",
    "neighborhood": "Centro",
    "number": "100",
    "cep": "01000-000",
    "city": "Sao Paulo",
    "state": "SP"
  },
  "status": "Ativa"
}
```

## TechnicalProgram

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Nome do curso macro |
| `description` | string | no | Descricao do programa |
| `totalWorkloadHours` | number | yes | Carga horaria total |
| `status` | string | no | `Ativo` ou `Inativo` |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-programs` | Criar curso macro |
| `GET` | `/api/technical-programs` | Listar cursos macro |
| `GET` | `/api/technical-programs/:id` | Buscar curso macro |
| `PATCH` | `/api/technical-programs/:id` | Atualizar curso macro |
| `PATCH` | `/api/technical-programs/:id/inactivate` | Inativar curso macro |

### Exemplo de request

```json
{
  "name": "Tecnico em Seguranca do Trabalho",
  "description": "Curso tecnico para formacao em seguranca ocupacional.",
  "totalWorkloadHours": 1200
}
```

## TechnicalProgramModule

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `technicalProgramId` | objectId | yes | Programa macro ao qual o modulo pertence |
| `subjectId` | objectId | no | Catalogacao opcional de disciplina |
| `name` | string | yes | Nome do modulo |
| `description` | string | no | Descricao do modulo |
| `moduleOrder` | number | yes | Ordem curricular dentro do programa |
| `workloadHours` | number | yes | Carga horaria do modulo |
| `status` | string | no | `Ativo` ou `Inativo` |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-program-modules` | Criar modulo do curso |
| `GET` | `/api/technical-program-modules` | Listar modulos do curso |
| `GET` | `/api/technical-program-modules/:id` | Buscar modulo por id |
| `PATCH` | `/api/technical-program-modules/:id` | Atualizar modulo |
| `PATCH` | `/api/technical-program-modules/:id/inactivate` | Inativar modulo |

### Exemplo de request

```json
{
  "technicalProgramId": "66f0a1b2c3d4e5f678901234",
  "subjectId": "66f0a1b2c3d4e5f678901245",
  "name": "Normas Regulamentadoras",
  "description": "Modulo base de seguranca do trabalho.",
  "moduleOrder": 1,
  "workloadHours": 80
}
```

## TechnicalSpace

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `name` | string | yes | Nome do espaco fisico |
| `type` | string | yes | `Sala`, `Laboratorio`, `Oficina`, `Auditorio`, `Outro` |
| `capacity` | number | yes | Capacidade minima 1 |
| `status` | string | no | `Ativo` ou `Inativo` |
| `notes` | string | no | Observacoes |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-spaces` | Criar espaco tecnico |
| `GET` | `/api/technical-spaces` | Listar espacos tecnicos |
| `GET` | `/api/technical-spaces/:id` | Buscar espaco por id |
| `PATCH` | `/api/technical-spaces/:id` | Atualizar espaco |
| `PATCH` | `/api/technical-spaces/:id/inactivate` | Inativar espaco |

### Exemplo de request

```json
{
  "name": "Laboratorio 01",
  "type": "Laboratorio",
  "capacity": 24,
  "notes": "Equipado para aulas praticas."
}
```

## TechnicalProgramOffering

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `technicalProgramId` | objectId | yes | Programa macro que esta sendo executado |
| `name` | string | yes | Nome interno ou comercial da oferta |
| `code` | string | no | Identificador opcional |
| `status` | string | no | `Planejada`, `Ativa`, `Concluída`, `Suspensa`, `Cancelada` |
| `plannedStartDate` | date | yes | Inicio previsto |
| `plannedEndDate` | date | yes | Termino previsto |
| `actualStartDate` | date | no | Inicio real |
| `actualEndDate` | date | no | Termino real |
| `shift` | string | no | `Manha`, `Tarde`, `Noite`, `Integral` |
| `capacity` | number | no | Capacidade da oferta |
| `defaultSpaceId` | objectId | no | Espaco padrao da oferta |
| `notes` | string | no | Observacoes |
| `modules` | virtual | no | Lista populada de `TechnicalProgramOfferingModule` |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-program-offerings` | Criar oferta concreta |
| `GET` | `/api/technical-program-offerings` | Listar ofertas |
| `GET` | `/api/technical-program-offerings/:id` | Buscar oferta por id |
| `PATCH` | `/api/technical-program-offerings/:id` | Atualizar oferta |

### Exemplo de request

```json
{
  "technicalProgramId": "66f0a1b2c3d4e5f678901234",
  "name": "TST 2026 - Turma 01",
  "code": "TST-2026-01",
  "plannedStartDate": "2026-02-10T00:00:00.000Z",
  "plannedEndDate": "2026-11-20T00:00:00.000Z",
  "shift": "Noite",
  "capacity": 30,
  "defaultSpaceId": "66f0a1b2c3d4e5f678901260",
  "notes": "Oferta principal do ano."
}
```

### Exemplo de response

```json
{
  "_id": "66f0a1b2c3d4e5f678901270",
  "technicalProgramId": {
    "_id": "66f0a1b2c3d4e5f678901234",
    "name": "Tecnico em Seguranca do Trabalho",
    "totalWorkloadHours": 1200,
    "status": "Ativo"
  },
  "name": "TST 2026 - Turma 01",
  "code": "TST-2026-01",
  "status": "Planejada",
  "plannedStartDate": "2026-02-10T00:00:00.000Z",
  "plannedEndDate": "2026-11-20T00:00:00.000Z",
  "shift": "Noite",
  "capacity": 30,
  "defaultSpaceId": {
    "_id": "66f0a1b2c3d4e5f678901260",
    "name": "Sala 03",
    "type": "Sala",
    "capacity": 30,
    "status": "Ativo"
  },
  "modules": []
}
```

## TechnicalProgramOfferingModule

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `technicalProgramOfferingId` | objectId | yes | Oferta concreta onde a execucao acontece |
| `technicalProgramModuleId` | objectId | yes | Modulo curricular executado nesta oferta |
| `executionOrder` | number | no | O backend pode derivar da ordem curricular quando omitido |
| `moduleOrderSnapshot` | number | no | O backend copia `moduleOrder` quando omitido |
| `plannedWorkloadHours` | number | no | O backend copia `workloadHours` do modulo quando omitido |
| `plannedWeeklyMinutes` | number | no | Computado a partir dos slots |
| `estimatedWeeks` | number | no | Computado a partir da carga e da agenda |
| `estimatedStartDate` | date | no | Pode ser derivada |
| `estimatedEndDate` | date | no | Pode ser derivada |
| `prerequisiteModuleIds` | array<objectId> | no | Pre-requisitos da execucao |
| `scheduleSlots` | array | no | Agenda embutida da execucao |
| `status` | string | no | `Planejado`, `Em andamento`, `Concluído`, `Suspenso`, `Cancelado` |
| `notes` | string | no | Observacoes |

### `scheduleSlots`

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `weekday` | number | yes | 1 a 7 |
| `startTime` | string | yes | Formato `HH:MM` |
| `endTime` | string | yes | Formato `HH:MM` |
| `teacherIds` | array<objectId> | no | IDs de `User` com role `Professor` |
| `spaceId` | objectId | no | Usa o espaco do slot ou o `defaultSpaceId` da oferta |
| `durationMinutes` | number | no | Computado pelo backend |
| `notes` | string | no | Observacoes |
| `status` | string | no | `Ativo` ou `Inativo` |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-program-offering-modules` | Criar execucao do modulo na oferta |
| `GET` | `/api/technical-program-offering-modules` | Listar execucoes de modulos |
| `GET` | `/api/technical-program-offering-modules/:id` | Buscar execucao por id |
| `PATCH` | `/api/technical-program-offering-modules/:id` | Atualizar execucao |
| `PATCH` | `/api/technical-program-offering-modules/:id/inactivate` | Cancelar execucao do modulo |

### Regras de validacao

- `technicalProgramOfferingId` precisa existir e pertencer a mesma escola.
- `technicalProgramModuleId` precisa existir e pertencer ao mesmo programa da oferta.
- `prerequisiteModuleIds` precisam ser do mesmo programa.
- `teacherIds` precisam existir, pertencer a escola, estar `Ativo` e ter role `Professor`.
- `spaceId` precisa existir na escola.
- Se `spaceId` nao vier no slot, o backend usa `defaultSpaceId` da oferta quando existir.
- `plannedWeeklyMinutes`, `estimatedWeeks`, `estimatedStartDate` e `estimatedEndDate` sao derivados quando ha dados suficientes.
- `executionOrder`, `moduleOrderSnapshot` e `plannedWorkloadHours` podem ser omitidos no request e sao derivados do modulo quando necessario.

### Exemplo de request

```json
{
  "technicalProgramOfferingId": "66f0a1b2c3d4e5f678901270",
  "technicalProgramModuleId": "66f0a1b2c3d4e5f678901280",
  "executionOrder": 1,
  "moduleOrderSnapshot": 1,
  "plannedWorkloadHours": 80,
  "prerequisiteModuleIds": [],
  "estimatedStartDate": "2026-02-10T00:00:00.000Z",
  "scheduleSlots": [
    {
      "weekday": 2,
      "startTime": "19:00",
      "endTime": "21:00",
      "teacherIds": ["66f0a1b2c3d4e5f678901290"],
      "spaceId": "66f0a1b2c3d4e5f678901260",
      "notes": "Aula de abertura"
    }
  ],
  "notes": "Primeira execucao do modulo."
}
```

### Exemplo de response

```json
{
  "_id": "66f0a1b2c3d4e5f6789012a0",
  "technicalProgramOfferingId": {
    "_id": "66f0a1b2c3d4e5f678901270",
    "name": "TST 2026 - Turma 01",
    "technicalProgramId": {
      "_id": "66f0a1b2c3d4e5f678901234",
      "name": "Tecnico em Seguranca do Trabalho",
      "totalWorkloadHours": 1200
    },
    "defaultSpaceId": {
      "_id": "66f0a1b2c3d4e5f678901260",
      "name": "Sala 03",
      "type": "Sala",
      "capacity": 30
    }
  },
  "technicalProgramModuleId": {
    "_id": "66f0a1b2c3d4e5f678901280",
    "name": "Normas Regulamentadoras",
    "moduleOrder": 1,
    "workloadHours": 80
  },
  "executionOrder": 1,
  "moduleOrderSnapshot": 1,
  "plannedWorkloadHours": 80,
  "plannedWeeklyMinutes": 120,
  "estimatedWeeks": 40,
  "estimatedStartDate": "2026-02-10T00:00:00.000Z",
  "estimatedEndDate": "2026-11-17T00:00:00.000Z",
  "scheduleSlots": [
    {
      "weekday": 2,
      "startTime": "19:00",
      "endTime": "21:00",
      "teacherIds": [
        {
          "_id": "66f0a1b2c3d4e5f678901290",
          "fullName": "Joao Professor",
          "email": "joao.professor@soulflink.com",
          "roles": ["Professor"],
          "status": "Ativo"
        }
      ],
      "spaceId": {
        "_id": "66f0a1b2c3d4e5f678901260",
        "name": "Sala 03",
        "type": "Sala",
        "capacity": 30
      },
      "durationMinutes": 120,
      "status": "Ativo"
    }
  ],
  "status": "Planejado"
}
```

## TechnicalEnrollment

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `studentId` | objectId | yes | Participante base |
| `companyId` | objectId | yes | Empresa parceira |
| `technicalProgramId` | objectId | yes | Curso macro |
| `currentTechnicalProgramOfferingId` | objectId | no | Oferta concreta atual |
| `currentClassId` | objectId | no | Turma atual, ainda util para compatibilidade |
| `enrollmentDate` | date | no | Default do backend |
| `status` | string | no | `Pendente`, `Ativa`, `Concluída`, `Cancelada` |
| `notes` | string | no | Observacoes |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-enrollments` | Criar matricula tecnica |
| `GET` | `/api/technical-enrollments` | Listar matriculas tecnicas |
| `GET` | `/api/technical-enrollments/:id` | Buscar matricula por id |
| `PATCH` | `/api/technical-enrollments/:id` | Atualizar matricula |

### Regras de validacao

- O mesmo `studentId + technicalProgramId + school_id` continua unico.
- A matricula pode nascer sem turma e sem oferta.
- Se `currentTechnicalProgramOfferingId` vier preenchido, ela precisa pertencer a mesma escola e ao mesmo `technicalProgramId`.
- Se `currentClassId` vier preenchido, a turma precisa pertencer a mesma escola.
- O backend define `status = Ativa` quando a matricula nasce com turma ou oferta.

### Exemplo de request

```json
{
  "studentId": "66f0a1b2c3d4e5f6789012b0",
  "companyId": "66f0a1b2c3d4e5f6789012c0",
  "technicalProgramId": "66f0a1b2c3d4e5f678901234",
  "currentTechnicalProgramOfferingId": null,
  "currentClassId": null,
  "notes": "Matricula inicial sem alocacao operacional."
}
```

### Exemplo de response

```json
{
  "_id": "66f0a1b2c3d4e5f6789012d0",
  "studentId": {
    "_id": "66f0a1b2c3d4e5f6789012b0",
    "fullName": "Ana Participante",
    "birthDate": "2004-05-10T00:00:00.000Z",
    "cpf": "123.456.789-10"
  },
  "companyId": {
    "_id": "66f0a1b2c3d4e5f6789012c0",
    "name": "Soulflink Ltda",
    "legalName": "Soulflink Educacao Tecnica Ltda",
    "cnpj": "12.345.678/0001-90"
  },
  "technicalProgramId": {
    "_id": "66f0a1b2c3d4e5f678901234",
    "name": "Tecnico em Seguranca do Trabalho",
    "totalWorkloadHours": 1200
  },
  "currentTechnicalProgramOfferingId": null,
  "currentClassId": null,
  "enrollmentDate": "2026-01-15T00:00:00.000Z",
  "status": "Pendente"
}
```

## TechnicalModuleRecord

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `technicalEnrollmentId` | objectId | yes | Matricula tecnica |
| `technicalProgramModuleId` | objectId | yes | Modulo curricular |
| `technicalProgramOfferingId` | objectId | no | Oferta concreta |
| `technicalProgramOfferingModuleId` | objectId | no | Execucao concreta do modulo na oferta |
| `attemptNumber` | number | no | Gerado pelo backend com base nas tentativas anteriores |
| `moduleWorkloadHours` | number | no | Copia da carga do modulo, preenchida pelo backend |
| `completedHours` | number | no | Horas concluidas na tentativa |
| `status` | string | no | `Pendente`, `Em andamento`, `Concluído`, `Reprovado`, `Repetindo` |
| `startedAt` | date | no | Pode ser calculado pelo backend |
| `finishedAt` | date | no | Pode ser calculado pelo backend |
| `notes` | string | no | Observacoes |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-module-records` | Criar historico de modulo |
| `GET` | `/api/technical-module-records` | Listar historicos |
| `GET` | `/api/technical-module-records/:id` | Buscar historico por id |
| `PATCH` | `/api/technical-module-records/:id` | Atualizar historico |

### Regras de validacao

- O modulo precisa pertencer ao mesmo programa da matricula.
- Se `technicalProgramOfferingModuleId` vier preenchido, ele precisa corresponder ao mesmo modulo.
- Se `technicalProgramOfferingId` vier preenchido, ele precisa pertencer a mesma escola e ao mesmo programa da matricula.
- Se a matricula ja tiver oferta atual, o historico nao pode apontar para outra oferta.
- `completedHours` nao pode ser negativa nem maior que a carga do modulo.
- `attemptNumber` e calculado pelo backend com base nas tentativas anteriores.

### Exemplo de request

```json
{
  "technicalEnrollmentId": "66f0a1b2c3d4e5f6789012d0",
  "technicalProgramModuleId": "66f0a1b2c3d4e5f678901280",
  "technicalProgramOfferingId": "66f0a1b2c3d4e5f678901270",
  "technicalProgramOfferingModuleId": "66f0a1b2c3d4e5f6789012a0",
  "status": "Em andamento",
  "notes": "Modulo em execucao na oferta atual."
}
```

### Exemplo de response

```json
{
  "_id": "66f0a1b2c3d4e5f6789012e0",
  "technicalEnrollmentId": {
    "_id": "66f0a1b2c3d4e5f6789012d0",
    "status": "Pendente"
  },
  "technicalProgramModuleId": {
    "_id": "66f0a1b2c3d4e5f678901280",
    "name": "Normas Regulamentadoras",
    "moduleOrder": 1,
    "workloadHours": 80
  },
  "technicalProgramOfferingId": {
    "_id": "66f0a1b2c3d4e5f678901270",
    "name": "TST 2026 - Turma 01"
  },
  "technicalProgramOfferingModuleId": {
    "_id": "66f0a1b2c3d4e5f6789012a0",
    "executionOrder": 1
  },
  "attemptNumber": 1,
  "moduleWorkloadHours": 80,
  "completedHours": 0,
  "status": "Em andamento"
}
```

## TechnicalClassMovement

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `technicalEnrollmentId` | objectId | yes | Matricula tecnica |
| `fromClassId` | objectId | no | Derivado da turma atual da matricula |
| `toClassId` | objectId | yes | Turma de destino |
| `movedAt` | date | no | Default do backend |
| `reason` | string | no | Motivo |
| `notes` | string | no | Observacoes |
| `performedByUserId` | objectId | no | Usuario que executou a troca |

### Rotas

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/api/technical-class-movements` | Registrar troca de turma |
| `GET` | `/api/technical-class-movements` | Listar movimentos |
| `GET` | `/api/technical-class-movements/:id` | Buscar movimento por id |

### Regras de validacao

- A matricula precisa ter `currentClassId` preenchido.
- `fromClassId` e derivado da turma atual da matricula, nao e enviado pelo front.
- `fromClassId` e `toClassId` nao podem ser iguais.
- A troca atualiza `TechnicalEnrollment.currentClassId` e preserva o historico.

### Exemplo de request

```json
{
  "technicalEnrollmentId": "66f0a1b2c3d4e5f6789012d0",
  "toClassId": "66f0a1b2c3d4e5f6789012f0",
  "reason": "Mudanca de turno",
  "notes": "Transferencia solicitada pela empresa."
}
```

### Exemplo de response

```json
{
  "_id": "66f0a1b2c3d4e5f678901300",
  "technicalEnrollmentId": {
    "_id": "66f0a1b2c3d4e5f6789012d0",
    "currentClassId": {
      "_id": "66f0a1b2c3d4e5f6789012f0",
      "name": "TST Noite 01"
    }
  },
  "fromClassId": {
    "_id": "66f0a1b2c3d4e5f6789012e5",
    "name": "TST Manha 01"
  },
  "toClassId": {
    "_id": "66f0a1b2c3d4e5f6789012f0",
    "name": "TST Noite 01"
  },
  "movedAt": "2026-03-01T00:00:00.000Z",
  "reason": "Mudanca de turno"
}
```

## Resumo de relacoes

| Relacao | Regra atual |
| --- | --- |
| `School -> Company` | isolamento por escola |
| `School -> TechnicalProgram` | isolamento por escola |
| `TechnicalProgram -> TechnicalProgramModule` | modulo pertence ao programa macro |
| `TechnicalProgram -> TechnicalProgramOffering` | oferta pertence ao programa macro |
| `TechnicalProgramOffering -> TechnicalProgramOfferingModule` | a oferta agrega execucoes de modulos |
| `TechnicalProgramOfferingModule -> scheduleSlots` | agenda embutida no modulo da oferta |
| `TechnicalProgramOfferingModule -> User` | professores por slot via `teacherIds` |
| `TechnicalProgramOfferingModule -> TechnicalSpace` | espaco por slot ou espaco padrao da oferta |
| `TechnicalEnrollment -> Student/Company/TechnicalProgram` | vinculo academico individual |
| `TechnicalEnrollment -> TechnicalProgramOffering` | opcional no nascimento, permitido no update |
| `TechnicalModuleRecord -> TechnicalEnrollment/TechnicalProgramModule` | historico individual por modulo |
| `TechnicalModuleRecord -> TechnicalProgramOffering/TechnicalProgramOfferingModule` | contexto de execucao quando existir |
| `TechnicalClassMovement -> TechnicalEnrollment/Class` | compatibilidade com o fluxo de turma legado |

## Erros esperados

| Situacao | Status HTTP | Observacao |
| --- | --- | --- |
| Usuario sem token ou sem escola | 403 | usuario nao autenticado |
| Recurso inexistente ou de outra escola | 404 | nao encontrado |
| Dado duplicado | 409 | CNPJ, modulo, oferta, ordem ou tentativa duplicada |
| Dados invalidos | 400 | validacao de schema ou regras de negocio |

## Observacoes para o front

- `TechnicalProgramOffering` nao substitui `TechnicalProgram`.
- `TechnicalProgramOfferingModule` e a camada correta para agenda, professor e espaco por execucao.
- `TechnicalEnrollment.currentClassId` pode ser `null`.
- `TechnicalEnrollment.currentTechnicalProgramOfferingId` pode ser `null`.
- `contactPerson` da empresa nao e `Tutor`.
- `subjectId` continua opcional nos modulos.
- `logoUrl` nao e a fonte canonica da imagem da empresa; use `GET /api/companies/:id/logo`.
- `Horario` regular nao e a grade tecnica.

## Atualizacao operacional desta rodada

### Progressao agregada

- `GET /api/technical-enrollments/:id/progress`

Resposta consolidada:

- `enrollment`: matricula populada com empresa, programa e oferta atual quando existir
- `summary`: totais de modulos, horas planejadas, horas concluídas, horas restantes e status geral
- `modules`: visao por modulo curricular com `latestRecord`, `attempts`, `offeringExecution`, `plannedHours`, `completedHours`, `remainingHours`, `progressPercentage` e `status`

### Migração entre ofertas

Novo dominio:

- `technicalEnrollmentOfferingMovement`

Campos:

- `technicalEnrollmentId`
- `fromTechnicalProgramOfferingId`
- `toTechnicalProgramOfferingId`
- `movementType` (`AtribuicaoInicial` ou `Transferencia`)
- `movedAt`
- `reason`
- `notes`
- `performedByUserId`
- `school_id`

Rotas:

- `POST /api/technical-enrollment-offering-movements`
- `GET /api/technical-enrollment-offering-movements`
- `GET /api/technical-enrollment-offering-movements/:id`

### Regras endurecidas

- `PATCH /api/technical-enrollments/:id` nao e o caminho para trocar oferta atual quando ela ja existe.
- `PATCH /api/technical-enrollments/:id` nao e o caminho para trocar turma atual quando ela ja existe.
- `PATCH /api/technical-enrollments/:id` nao deve ser usado para trocar `studentId` ou `companyId` quando ja existe historico ou vinculo operacional.
- `technicalModuleRecord` herda a oferta atual da matricula quando nao recebe uma oferta explicitamente.
- quando a oferta existe, o `technicalModuleRecord` passa a exigir a execucao correspondente do modulo na oferta.
- `technicalProgramOfferingModule` rejeita conflitos de horario quando professor ou espaco se sobrepoem dentro da mesma oferta.
