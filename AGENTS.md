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
- tratar `technicalProgramOffering` como a execucao concreta do curso
- tratar `technicalProgramOfferingModule` como a execucao do modulo dentro da oferta, com agenda embutida
- tratar `TechnicalEnrollment` como o vinculo academico individual
- considerar `TechnicalEnrollment.currentClassId` opcional na criacao
- considerar `TechnicalEnrollment.currentTechnicalProgramOfferingId` opcional na criacao
- usar `GET /api/technical-enrollments/:id/progress` para leitura agregada de progresso
- nao trocar `studentId` ou `companyId` de uma matricula que ja possua historico ou vinculo operacional
- representar varios cursos por participante com varios `TechnicalEnrollment`
- nao acoplar empresa em `Tutor`
- tratar `Company.contactPerson` como o contato principal da empresa
- tratar `TechnicalSpace` como recurso fisico reutilizavel
- tratar `User` como referencia de professor nos slots da oferta tecnica
- nao usar `Class` nem `Horario` como espinha da execucao tecnica
- usar `TechnicalEnrollmentOfferingMovement` para migracao entre ofertas tecnicas
- manter `TechnicalClassMovement` para o eixo de turma legado/compatibilidade
- evitar duplicacao conceitual entre curso/programa/oferta
- preservar historico em `TechnicalModuleRecord` e `TechnicalClassMovement`
- `TechnicalModuleRecord` deve preferir contexto de oferta e execucao quando existir
- lembrar que `Student.address`/`Company.address` usam `cep`, enquanto `School.address` usa `zipCode`
- no Flutter, comecar por models, services e providers antes de tocar telas

## Nomes importantes

- `companyId`
- `technicalProgramId`
- `technicalProgramModuleId`
- `technicalProgramOfferingId`
- `technicalProgramOfferingModuleId`
- `technicalSpaceId`
- `technicalEnrollmentId`
- `currentClassId`
- `currentTechnicalProgramOfferingId`
- `technicalEnrollmentOfferingMovement`
- `scheduleSlots`
- `teacherIds`
- `technicalModuleRecord`
- `technicalClassMovement`
