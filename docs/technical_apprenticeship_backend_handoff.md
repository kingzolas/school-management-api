# Handoff Backend - Ensino Tecnico / Jovem Aprendiz

Documento do estado final atual da API tecnica. Use este arquivo como fonte de verdade para o front Flutter e para novos agentes.

## O que mudou nesta rodada

- `TechnicalProgramOfferingModule` foi criado como a camada que liga a oferta concreta ao modulo do curso.
- A agenda/slots agora vive dentro da execucao do modulo da oferta.
- `TechnicalProgramOffering` segue como a execucao concreta do curso macro e responde com `modules` populado.
- `TechnicalModuleRecord` passou a carregar oferta e execucao do modulo quando informados.
- `TechnicalEnrollment` agora pode apontar para a oferta concreta sem obrigar isso no nascimento.
- `TechnicalSpace` continua como recurso fisico reutilizavel.
- `TechnicalClassMovement` permanece como historico legado de troca de turma.
- `TechnicalEnrollmentOfferingMovement` passou a registrar a migracao entre ofertas tecnicas como historico proprio.
- `TechnicalEnrollment` agora bloqueia a troca direta de oferta ou turma quando ja existe vinculo atual; a troca deve usar os fluxos de movimentacao.
- `TechnicalEnrollment` tambem bloqueia a troca de `studentId` e `companyId` quando ja existe historico operacional.
- Existe uma leitura agregada de progresso por participante em `GET /api/technical-enrollments/:id/progress`.

## Contexto de negocio

- `School.educationModel = regular` ou `technical_apprenticeship`.
- Regular e tecnico continuam separados.
- No tecnico, empresa e a entidade institucional central.
- Curso macro, oferta concreta, modulo executado e progresso individual ficam separados.

## Semantica final dos dominios

| Dominio | Papel | Observacao |
| --- | --- | --- |
| `technicalProgram` | curso/programa macro | template curricular do curso, sem agenda e sem execucao concreta |
| `technicalProgramModule` | modulo/disciplina do curso | define ordem, carga horaria e referencia opcional a `Subject` |
| `technicalProgramOffering` | execucao concreta do curso | define periodo, turno, capacidade, espaco padrao e agrega os modulos da oferta |
| `technicalProgramOfferingModule` | execucao de um modulo dentro da oferta | concentra ordem real, snapshot curricular, prerequisitos, slots e estimativas |
| `technicalSpace` | recurso fisico reutilizavel | sala, laboratorio, oficina ou outro espaco tecnico |
| `TechnicalEnrollment` | vinculo academico individual | amarra aluno, empresa, programa e opcionalmente oferta/turma |
| `TechnicalModuleRecord` | historico individual por modulo | preserva tentativas e contexto da oferta quando existir |
| `TechnicalClassMovement` | historico de troca de turma | compatibilidade com o legado e operacao de turma do fluxo tecnico |

## Fluxo suportado agora

1. Criar `TechnicalProgram`.
2. Criar `TechnicalProgramModule`.
3. Criar `TechnicalSpace`.
4. Criar `TechnicalProgramOffering`.
5. Criar `TechnicalProgramOfferingModule` com `scheduleSlots`.
6. Criar `TechnicalEnrollment`.
7. Registrar `TechnicalModuleRecord`.
8. Registrar `TechnicalClassMovement` quando houver turma atual.

## Como a oferta concreta funciona

- `TechnicalProgramOffering` guarda o contexto da execucao: datas, turno, capacidade, espaco padrao e observacoes.
- Os modulos executados naquela oferta vivem em `TechnicalProgramOfferingModule`.
- A resposta da oferta traz `modules` via virtual populado.
- Cada modulo da oferta pode carregar varios `scheduleSlots`.
- Cada slot pode apontar para um ou mais professores via `User` e para um `TechnicalSpace`.
- A previsao temporal nasce na camada de oferta do modulo, nao no curso macro.

## Reuso do legado

- `School` continua sendo a raiz da multi-tenancy.
- `Student` continua sendo a pessoa.
- `Subject` continua sendo catalogacao opcional de disciplina.
- `User` continua sendo a identidade de professor usada nos slots.
- `addressSchema` continua sendo reutilizado em `Student` e `Company`.
- `StaffProfile` continua sendo contexto de RH e perfil profissional, nao espinha da execucao tecnica.

## O que nao foi reaproveitado como nucleo do tecnico

- `Tutor`
- `ReportCard`
- `Grade`
- `Periodo`
- `Enrollment` regular como espinha do tecnico
- `Class` regular como espinha da oferta tecnica
- `Horario` regular como espinha da grade tecnica
- `StaffProfile` como motor de agenda tecnica

## Diferenca entre regular e tecnico

### Ensino regular

- aluno vinculado a tutor/responsavel
- financeiro normalmente vinculado ao tutor
- progresso muito ligado a turma, serie e periodo
- `Class` e `Horario` sao centrais na organizacao da jornada

### Ensino tecnico / jovem aprendiz

- participante vinculado a empresa
- empresa e a entidade institucional central
- a oferta concreta organiza a execucao
- o progresso e individual
- o participante pode mudar de turma ou de oferta ao longo do percurso
- o mesmo participante pode fazer mais de um curso tecnico

## O que mudou em relacao ao primeiro handoff

- A oferta deixou de ser apenas um cabechao de datas e passou a ser a base da execucao concreta.
- Entrou a camada `TechnicalProgramOfferingModule`.
- A agenda passou a viver dentro da execucao do modulo da oferta.
- O progresso individual passou a carregar contexto de oferta e execucao do modulo.
- O front nao deve mais depender de `Class` ou `Horario` para representar o tecnico.

## O que ainda fica pendente

- ainda nao existe assistencia por slot de agenda
- ainda nao existe conflito automatizado de professor por horario entre diferentes ofertas
- ainda nao existe historico de aula/slot individual
- ainda nao existe camada de transacao formal no movimento de turma/oferta
- a regra atual continua bloqueando a repeticao do mesmo par `student + technicalProgram`
- `PATCH /api/technical-enrollments/:id` nao deve ser usado para trocar oferta ou turma quando o vinculo atual ja existe; use os fluxos de movimentacao

## Documento complementar

Para a leitura pratica do legado reutilizavel pelo front, ver:

- `docs/technical_apprenticeship_legacy_reuse.md`
