# Frontend Mapping - Flutter

Mapa de implementacao para o app `academyhub` com base no estado final atual da API tecnica.

## Interpretacao do dominio tecnico

- `technicalProgram` e o curso/programa macro.
- `technicalProgramModule` e o modulo/disciplina do curso.
- `technicalProgramOffering` e a execucao concreta do curso.
- `technicalProgramOfferingModule` e a execucao de um modulo dentro da oferta, com agenda embutida.
- `technicalSpace` e o recurso fisico reutilizavel.
- `TechnicalEnrollment` e o vinculo academico individual.
- `TechnicalModuleRecord` e o historico individual por modulo.
- `TechnicalClassMovement` continua sendo historico de turma legado.

## Fluxo correto no front

1. Ler `School.educationModel`.
2. Se for `technical_apprenticeship`, abrir o fluxo tecnico.
3. Criar ou selecionar `Company`.
4. Criar ou selecionar `TechnicalProgram`.
5. Criar os `TechnicalProgramModule` do programa.
6. Criar ou selecionar `TechnicalSpace`.
7. Criar a `TechnicalProgramOffering`.
8. Criar os `TechnicalProgramOfferingModule` e suas `scheduleSlots`.
9. Criar o `TechnicalEnrollment` com `studentId`, `companyId` e `technicalProgramId`.
10. Permitir `currentClassId` e `currentTechnicalProgramOfferingId` como opcionais no cadastro inicial.
11. Registrar `TechnicalModuleRecord` com contexto de oferta e execucao quando existir.
12. Registrar `TechnicalClassMovement` apenas quando houver uma turma atual e a operacao fizer sentido no legado.

## Models Flutter para criar ou ajustar

| Arquivo Flutter | Acao | Observacao |
| --- | --- | --- |
| `school_model.dart` | ajustar | Ler e enviar `educationModel` |
| `company_model.dart` | ajustar | Incluir `contactPerson`, `logoUrl`, `status` e `address` com `cep` |
| `technical_program_model.dart` | criar | Curso macro |
| `technical_program_module_model.dart` | criar | Modulo/disciplina do curso |
| `technical_program_offering_model.dart` | criar | Execucao concreta do curso |
| `technical_program_offering_module_model.dart` | criar | Execucao do modulo na oferta e `scheduleSlots` |
| `technical_space_model.dart` | criar | Espaco fisico reutilizavel |
| `technical_enrollment_model.dart` | ajustar | `currentClassId` e `currentTechnicalProgramOfferingId` nulos sao validos |
| `technical_module_record_model.dart` | criar | Historico por modulo com contexto da oferta |
| `technical_class_movement_model.dart` | criar | Movimento de turma legado |
| `user_model.dart` | reaproveitar | Professor nos slots chega como `User` populado |
| `staff_profile_model.dart` | reaproveitar | Contexto de RH, nao espinha da execucao tecnica |

## Services Flutter para criar ou ajustar

| Arquivo Flutter | Acao | Observacao |
| --- | --- | --- |
| `school_service.dart` | ajustar | Ler e enviar `educationModel` |
| `company_service.dart` | ajustar | Suportar `contactPerson` e upload de `logo` |
| `technical_program_service.dart` | criar | CRUD do curso macro |
| `technical_program_module_service.dart` | criar | CRUD dos modulos do curso |
| `technical_program_offering_service.dart` | criar | CRUD da execucao concreta |
| `technical_program_offering_module_service.dart` | criar | CRUD da execucao do modulo e agenda |
| `technical_space_service.dart` | criar | CRUD do espaco fisico |
| `technical_enrollment_service.dart` | ajustar | Criar sem turma e sem oferta, e alocar depois |
| `technical_module_record_service.dart` | criar | Historico por modulo com oferta e execucao |
| `technical_class_movement_service.dart` | criar | Movimento de turma legado |

## Providers Flutter para criar ou ajustar

| Arquivo Flutter | Acao | Observacao |
| --- | --- | --- |
| `school_provider.dart` | ajustar | Alternar o fluxo com base em `educationModel` |
| `company_provider.dart` | ajustar | Expor `contactPerson` e logo |
| `technical_program_provider.dart` | criar | Estado do curso macro |
| `technical_program_module_provider.dart` | criar | Estado dos modulos do curso |
| `technical_program_offering_provider.dart` | criar | Estado da oferta concreta |
| `technical_program_offering_module_provider.dart` | criar | Estado da execucao do modulo e slots |
| `technical_space_provider.dart` | criar | Estado dos espacos fisicos |
| `technical_enrollment_provider.dart` | ajustar | Matricula tecnica pode nascer pendente |
| `technical_module_record_provider.dart` | criar | Historico individual por modulo |
| `technical_class_movement_provider.dart` | criar | Movimento de turma legado |

## Mapeamento API para Flutter

| API | Flutter |
| --- | --- |
| `School` | `SchoolModel` |
| `Company` | `CompanyModel` |
| `TechnicalProgram` | `TechnicalProgramModel` |
| `TechnicalProgramModule` | `TechnicalProgramModuleModel` |
| `TechnicalProgramOffering` | `TechnicalProgramOfferingModel` |
| `TechnicalProgramOfferingModule` | `TechnicalProgramOfferingModuleModel` |
| `TechnicalSpace` | `TechnicalSpaceModel` |
| `TechnicalEnrollment` | `TechnicalEnrollmentModel` |
| `TechnicalModuleRecord` | `TechnicalModuleRecordModel` |
| `TechnicalClassMovement` | `TechnicalClassMovementModel` |
| `User` | `UserModel` |

## Serializacao e desserializacao

- Requests enviam IDs como string.
- Responses podem trazer IDs como string ou como objeto populado.
- O parser precisa aceitar ambos os formatos.
- Campos de data devem virar `DateTime`.
- O serializer de request deve sempre enviar string de ID.
- `school_id` nunca deve ser enviado manualmente.
- `educationModel`, `status` e enums de dominio sao case-sensitive.
- `Company.contactPerson` pode vir `null`.
- `Company.contactPerson.fullName` e `Company.contactPerson.jobTitle` sao obrigatorios quando o objeto existe.
- `TechnicalEnrollment.currentClassId` pode vir `null`.
- `TechnicalEnrollment.currentTechnicalProgramOfferingId` pode vir `null`.
- `TechnicalProgramOffering.modules` vem populado na resposta, nao no request de criacao.
- `TechnicalProgramOfferingModule.scheduleSlots` e embutido e pode vir vazio.
- `scheduleSlots.teacherIds` pode vir populado como lista de `User`.
- `scheduleSlots.spaceId` pode vir populado como `TechnicalSpace`.
- `Company.logo` nao deve ser esperado como base do front; o consumo da imagem e pela rota `/api/companies/:id/logo`.
- `Student.address` e `Company.address` usam `cep`.
- `School.address` usa `zipCode`.

## Campos legados que podem ser reaproveitados no cadastro do participante

### Reaproveitaveis com seguranca

- `Student.fullName`
- `Student.birthDate`
- `Student.cpf`
- `Student.rg`
- `Student.email`
- `Student.phoneNumber`
- `Student.address`
- `Student.profilePicture`
- `Student.healthInfo`
- `Student.isActive`

### Reaproveitaveis com cuidado

- `Student.classId` apenas para legado regular
- `Student.tutors` apenas para regular
- `Student.financialResp` apenas para regular
- `Student.financialTutorId` apenas para regular
- `StaffProfile` apenas como contexto de RH e docente
- `Horario` apenas como estrutura regular

## Campos obrigatorios e opcionais

### Company

- obrigatorio: `name`, `cnpj`, `address`
- opcional: `legalName`, `stateRegistration`, `municipalRegistration`, `contactPerson`, `contactPhone`, `contactEmail`, `logoUrl`, `status`
- `contactPerson.fullName` e `contactPerson.jobTitle` sao obrigatorios quando o objeto existe

### TechnicalProgram

- obrigatorio: `name`, `totalWorkloadHours`
- opcional: `description`, `status`

### TechnicalProgramModule

- obrigatorio: `technicalProgramId`, `name`, `moduleOrder`, `workloadHours`
- opcional: `subjectId`, `description`, `status`

### TechnicalSpace

- obrigatorio: `name`, `type`, `capacity`
- opcional: `notes`, `status`

### TechnicalProgramOffering

- obrigatorio: `technicalProgramId`, `name`, `plannedStartDate`, `plannedEndDate`
- opcional: `code`, `status`, `actualStartDate`, `actualEndDate`, `shift`, `capacity`, `defaultSpaceId`, `notes`

### TechnicalProgramOfferingModule

- obrigatorio: `technicalProgramOfferingId`, `technicalProgramModuleId`
- opcional: `executionOrder`, `moduleOrderSnapshot`, `plannedWorkloadHours`, `prerequisiteModuleIds`, `scheduleSlots`, `estimatedStartDate`, `status`, `notes`
- `scheduleSlots` pode ficar vazio, mas se vier preenchido precisa respeitar `weekday`, `startTime` e `endTime`

### TechnicalEnrollment

- obrigatorio: `studentId`, `companyId`, `technicalProgramId`
- opcional: `currentClassId`, `currentTechnicalProgramOfferingId`, `notes`, `status`

### TechnicalModuleRecord

- obrigatorio: `technicalEnrollmentId`, `technicalProgramModuleId`
- opcional: `technicalProgramOfferingId`, `technicalProgramOfferingModuleId`, `status`, `completedHours`, `startedAt`, `finishedAt`, `notes`

### TechnicalClassMovement

- obrigatorio: `technicalEnrollmentId`, `toClassId`
- opcional: `reason`, `notes`, `movedAt`

## Telas que nao devem ser ajustadas ainda

- telas de `reportCard`
- telas de `grade`
- telas de `periodo`
- fluxo de `tutor`
- fluxo de matricula regular
- fluxo de boletim regular
- telas que assumam que `Class` ou `Horario` sao o nucleo da execucao tecnica
- tela de assistencia por slot
- tela de conflitos de professor por slot

## Pontos que continuam ambiguos e nao devem ser improvisados

- `contactPerson` e opcional no backend; nao force obrigatoriedade sem acordo.
- o backend aceita `currentClassId: null` e `currentTechnicalProgramOfferingId: null`, mas a UI nao deve expor "limpar vinculo" sem regra formal.
- `logoUrl` nao e gerado automaticamente; nao use como fonte principal de imagem.
- `subjectId` continua opcional; nao obrigue disciplina em todo modulo sem validacao de negocio.
- o mesmo participante ainda nao pode repetir o mesmo `technicalProgram` por este endpoint.
- `TechnicalClassMovement` continua dependente de `currentClassId`.
- ainda nao existe historia por slot individual na API.
- ainda nao existe conflito de agenda entre diferentes ofertas na API.

## Atualizacao operacional desta rodada

- `technicalEnrollment` continua sendo a matricula base, mas a visao de acompanhamento deve sair de `GET /api/technical-enrollments/:id/progress`.
- `technicalEnrollment.currentTechnicalProgramOfferingId` e `technicalEnrollment.currentClassId` nao devem ser trocados por `PATCH` quando ja existirem; o front deve usar os endpoints de movimentacao.
- `studentId` e `companyId` da matricula nao devem ser reapontados na edicao quando ja houver historico operacional.
- `technicalEnrollmentOfferingMovement` e o novo fluxo para migrar o participante entre ofertas sem perder historico.
- `technicalModuleRecord` deve ser enviado com `technicalProgramOfferingId` e `technicalProgramOfferingModuleId` quando a oferta atual existir, para manter o historico amarrado a execucao concreta.
- `technicalProgramOfferingModule.scheduleSlots` e a fonte de verdade da grade tecnica; o front nao deve inventar a grade a partir de `Class` ou `Horario`.
- `technicalProgramOfferingModule` e `technicalSpace` continuam sendo as referencias corretas para sala, professor e previsao da execucao.

## Recomendacao de implementacao

1. montar os models primeiro
2. depois os services
3. em seguida os providers
4. por fim as telas e os fluxos visuais
