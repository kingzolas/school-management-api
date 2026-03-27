# AGENTS.md

Referencia rapida para agentes futuros neste repositorio.

## Leia primeiro

- `docs/technical_apprenticeship_backend_handoff.md`
- `docs/technical_apprenticeship_api_contract.md`
- `docs/technical_apprenticeship_frontend_mapping.md`
- `docs/technical_apprenticeship_legacy_reuse.md`

## Regras de trabalho

- manter ensino regular e tecnico separados
- usar `educationModel` em `School` para decidir o fluxo
- tratar `technicalProgram` como curso macro
- tratar `technicalProgramModule` como modulo/disciplinas do curso
- tratar `TechnicalEnrollment` como o vinculo academico individual
- considerar `TechnicalEnrollment.currentClassId` opcional na criacao
- representar varios cursos por participante com varios `TechnicalEnrollment`
- nao acoplar empresa em `Tutor`
- tratar `Company.contactPerson` como o contato principal da empresa
- evitar duplicacao conceitual entre curso/programa
- preservar historico em `TechnicalModuleRecord` e `TechnicalClassMovement`
- lembrar que `Student.address`/`Company.address` usam `cep`, enquanto `School.address` usa `zipCode`
- no Flutter, comecar por models, services e providers antes de tocar telas

## Nomes importantes

- `companyId`
- `technicalProgramId`
- `technicalProgramModuleId`
- `technicalEnrollmentId`
- `currentClassId`
- `technicalModuleRecord`
- `technicalClassMovement`

