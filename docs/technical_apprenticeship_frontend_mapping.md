# Frontend Mapping - Flutter

Mapa de implementacao para o app `academyhub` com base no estado final atual da API tecnica.

## Objetivo

- manter o fluxo regular intacto
- tratar o tecnico como um dominio proprio
- evitar improvisar duplicacao conceitual entre curso, programa, disciplina e turma

## Leia junto

- `docs/technical_apprenticeship_backend_handoff.md`
- `docs/technical_apprenticeship_api_contract.md`
- `docs/technical_apprenticeship_legacy_reuse.md`

## Como interpretar o dominio tecnico

### `technicalProgram`

- interpretar como curso/programa macro
- usar como entidade principal da trilha tecnica
- nao criar uma tela ou model paralelo de `course`
- nao confundir com disciplina, modulo ou turma

### `technicalProgramModule`

- interpretar como modulo/disciplinas do curso
- usar como item de grade dentro de `technicalProgram`
- `subjectId` e apenas catalogacao opcional
- nao tratar como curso separado

### `TechnicalEnrollment`

- interpretar como o vinculo academico individual
- e o ponto de verdade da matricula tecnica do participante
- o participante pode ter varios `TechnicalEnrollment`, um por curso
- `currentClassId` pode vir `null` no cadastro inicial

## Cadastro tecnico: fluxo correto no front

1. carregar `School.educationModel`
2. se for tecnico, exibir area tecnica
3. criar ou selecionar a `Company`
4. criar ou selecionar o `TechnicalProgram`
5. criar os `TechnicalProgramModule` do programa
6. criar o `TechnicalEnrollment` com `studentId`, `companyId` e `technicalProgramId`
7. permitir `currentClassId` opcional no cadastro inicial
8. alocar a turma depois, quando existir a definicao operacional

## Models Flutter que devem ser criados ou ajustados

### Ajustar

- `school_model.dart`
  - adicionar `educationModel`
  - valores: `regular`, `technical_apprenticeship`

- `company_model.dart`
  - incluir `name`, `legalName`, `cnpj`, `stateRegistration`, `municipalRegistration`, `contactPhone`, `contactEmail`, `contactPerson`, `address`, `logoUrl`, `status`
  - `contactPerson` precisa ser um submodelo proprio

- `technical_enrollment_model.dart`
  - `currentClassId` opcional/nullable
  - `status` precisa aceitar `Pendente`

### Criar

- `technical_program_model.dart`
- `technical_program_module_model.dart`
- `technical_module_record_model.dart`
- `technical_class_movement_model.dart`

### Reaproveitar sem mudar o nucleo

- `student_model.dart`
- `class_model.dart`
- `subject_model.dart`
- `user_model.dart`

## Services Flutter que devem ser criados ou ajustados

### Ajustar

- `school_service.dart`
  - ler e enviar `educationModel`

- `company_service.dart`
  - suportar `contactPerson`
  - suportar upload de `logo`
  - consumir `GET /api/companies/:id/logo`

- `technical_enrollment_service.dart`
  - permitir criacao sem `currentClassId`
  - permitir alocacao posterior da turma
  - nao assumir que a turma define a matricula na criacao

### Criar

- `technical_program_service.dart`
- `technical_program_module_service.dart`
- `technical_module_record_service.dart`
- `technical_class_movement_service.dart`

## Providers Flutter que devem ser criados ou ajustados

### Ajustar

- `school_provider.dart`
  - carregar `educationModel`
  - usar esse campo para alternar o fluxo tecnico

- `company_provider.dart`
  - expor `contactPerson`
  - tratar logo como recurso separado

- `technical_enrollment_provider.dart`
  - lidar com matricula sem turma no estado inicial
  - apresentar a turma como dado opcional no cadastro

### Criar

- `technical_program_provider.dart`
- `technical_program_module_provider.dart`
- `technical_module_record_provider.dart`
- `technical_class_movement_provider.dart`

## Mapeamento API -> Flutter

| API | Flutter |
| --- | --- |
| `School` | `SchoolModel` |
| `Company` | `CompanyModel` |
| `TechnicalProgram` | `TechnicalProgramModel` |
| `TechnicalProgramModule` | `TechnicalProgramModuleModel` |
| `TechnicalEnrollment` | `TechnicalEnrollmentModel` |
| `TechnicalModuleRecord` | `TechnicalModuleRecordModel` |
| `TechnicalClassMovement` | `TechnicalClassMovementModel` |

## Serializacao e desserializacao

- requests usam IDs em string
- responses podem trazer IDs como string ou objeto populado
- o parser precisa aceitar ambos os formatos
- campos de data devem virar `DateTime`
- o serializer de request deve sempre enviar string de ID
- `school_id` nunca deve ser enviado manualmente
- `educationModel`, `status` e enums de dominio sao case-sensitive
- `Company.contactPerson` pode vir `null`
- `TechnicalEnrollment.currentClassId` pode vir `null`
- `Company.logo` nao deve ser esperado como base do front; o consumo da imagem e pela rota `/api/companies/:id/logo`

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

## Address: ponto de divergencia que o front precisa respeitar

- `Student.address` usa `addressSchema` com `cep`
- `Company.address` usa o mesmo `addressSchema` com `cep`
- `School.address` usa uma modelagem diferente com `zipCode`
- nao crie um unico serializer de endereco que assuma a mesma chave para todos os dominios

## Campos obrigatorios e opcionais

### School

- obrigatorio: `name`
- opcional: `educationModel`

### Company

- obrigatorio: `name`, `cnpj`, `address`
- opcional: `legalName`, `stateRegistration`, `municipalRegistration`, `contactPerson`, `contactPhone`, `contactEmail`, `logoUrl`
- `contactPerson.fullName` e `contactPerson.jobTitle` sao obrigatorios quando o objeto existir

### TechnicalProgram

- obrigatorio: `name`, `totalWorkloadHours`
- opcional: `description`

### TechnicalProgramModule

- obrigatorio: `technicalProgramId`, `name`, `moduleOrder`, `workloadHours`
- opcional: `subjectId`, `description`

### TechnicalEnrollment

- obrigatorio: `studentId`, `companyId`, `technicalProgramId`
- opcional: `currentClassId`, `notes`, `status`

### TechnicalModuleRecord

- obrigatorio: `technicalEnrollmentId`, `technicalProgramModuleId`
- os demais campos podem ser controlados pela tela

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
- qualquer tela que assuma que a turma define sozinha o progresso

## Integracoes minimas primeiro

1. ler `educationModel`
2. habilitar/desabilitar area tecnica pela escola
3. criar CRUD de `Company`
4. criar CRUD de `TechnicalProgram`
5. criar CRUD de `TechnicalProgramModule`
6. criar cadastro e consulta de `TechnicalEnrollment`
7. permitir matricula sem turma e alocacao posterior
8. criar timeline de `TechnicalModuleRecord`
9. criar historico de `TechnicalClassMovement`

## Pontos que continuam ambiguos e nao devem ser improvisados

- `contactPerson` e opcional no backend; nao force obrigatoriedade sem acordo
- o backend hoje aceita `currentClassId: null` em `PATCH`, mas a UI nao deve expor "limpar turma" sem regra formal
- `logoUrl` nao e gerado automaticamente; nao use como fonte principal de imagem
- `subjectId` e opcional; nao obrigue a disciplina em todo modulo sem validacao de negocio
- o mesmo participante nao pode repetir o mesmo `technicalProgram` por esse endpoint hoje
- `TechnicalClassMovement` so faz sentido quando a matricula ja tem turma atual

## Recomendacao de implementacao

- montar os models primeiro
- depois os services
- em seguida os providers
- por fim as telas e os fluxos visuais

