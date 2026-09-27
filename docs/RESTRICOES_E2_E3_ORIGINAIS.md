# Restrições originais de E2/E3 — referência para ajuste manual

> **Fonte:** `src/constants/layout.ts` do projeto analisado. Este arquivo é uma exportação documental das regras que estavam hardcoded originalmente. Não é uma migration e não deve ser executado no Supabase.

## Nova estrutura oficial

- **E2:** módulos **M1 a M172**, com **10 posições-base por módulo**.
- **E3:** módulos **M1 a M112**, com **12 posições-base por módulo**.
- As exceções abaixo são apenas a referência do desenho antigo. O ajuste físico deverá ser feito manualmente na nova configuração.

### Posições-base E2
`A1, A2, B1, B2, C1, C2, D1, D2, E1, E2`

### Posições-base E3
`A1, A2, B1, B2, C1, C2, D1, D2, E1, E2, F1, F2`

## E2 — posições originalmente bloqueadas

| Módulo | Posições bloqueadas originalmente |
|---:|---|
| M4 | E1 |
| M7 | A2, B2, C2, D2, E2 |
| M8 | A2, B2, C2, D2, E2 |
| M11 | A1, B1, C1, A2, B2, C2 |
| M18 | A1, B1, C1, A2, B2, C2 |
| M21 | A2, B2, C2, D2, E2 |
| M22 | A2, B2, C2, D2, E2 |
| M25 | A1, B1, C1, A2, B2, C2 |
| M32 | A1, B1, C1, A2, B2, C2 |
| M35 | A2, B2, C2, D2, E2 |
| M36 | A2, B2, C2, D2, E2 |
| M39 | A1, B1, C1, A2, B2, C2, D2, E2 |
| M46 | A1, B1, C1, A2, B2, C2 |
| M49 | A2, B2, C2, D2, E2 |
| M52 | A1, B1, C1, A2, B2, C2 |
| M59 | A1, B1, C1, A2, B2, C2 |
| M62 | A2, B2, C2, D2, E2 |
| M65 | A1, B1, C1, A2, B2, C2 |
| M72 | A1, B1, C1, A2, B2, C2, D1, E1 |
| M75 | A2, B2, C2, D2, E2 |
| M76 | A2, B2, C2, D2, E2 |
| M79 | A1, B1, C1, A2, B2, C2, D2, E2 |
| M86 | A1, B1, C1, A2, B2, C2 |
| M89 | A2, B2, C2, D2, E2 |
| M90 | A2, B2, C2, D2, E2 |
| M93 | A1, B1, C1, A2, B2, C2 |
| M100 | A1, B1, C1, A2, B2, C2 |
| M103 | A2, B2, C2, D2, E2 |
| M104 | A2, B2, C2, D2, E2 |
| M107 | A1, B1, C1, A2, B2, C2 |
| M114 | A1, B1, C1, A2, B2, C2, D1, E1 |
| M117 | A2, B2, C2, D2, E2 |
| M120 | A1, B1, C1, A2, B2, C2 |
| M125 | A1, B1, C1, A2, B2, C2 |
| M128 | A2, B2, C2, D2, E2 |
| M129 | A2, B2, C2, D2, E2 |
| M132 | A1, B1, C1, A2, B2, C2 |
| M139 | A1, B1, C1, A2, B2, C2 |
| M142 | A2, B2, C2, D2, E2 |
| M143 | A2, B2, C2, D2, E2 |
| M146 | A1, B1, C1, A2, B2, C2, D2, E2 |
| M153 | A1, B1, C1, A2, B2, C2 |
| M156 | A2, B2, C2, D2, E2 |
| M157 | A1, B1, C1, A2, B2, C2 |
| M164 | A1, B1, C1, A2, B2, C2, D2, E2 |
| M167 | A2, B2, C2, D2, E2 |
| M168 | A2, B2, C2, D2, E2 |

## E3 — posições originalmente bloqueadas

| Módulo | Posições bloqueadas originalmente |
|---:|---|
| M11 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M22 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M41 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M49 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M60 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M62 | F1 |
| M68 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M81 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M87 | F2 |
| M89 | A1, B1, C1, A2, B2, C2, F1, F2 |
| M95 | A2, B2, C2, D2, E2, F2 |
| M101 | F1 |

## E3 — posições extras originalmente existentes

| Módulo | Posições extras |
|---:|---|
| M7 | G1, H1, G2, H2 |
| M8 | G1, G2 |
| M9 | G1, G2 |
| M24 | G1, G2 |

## Regra de identificação de módulos

Foi definido que **não serão aceitos módulos com zero à esquerda**.

Exemplos:

- `M1` → válido
- `M4` → válido
- `M01` → não aceitar
- `M04` → não aceitar
- `M02` → não aceitar

Para a nova configuração, o identificador canônico deverá ser o número sem zero à esquerda (`1`, `2`, `4`, etc.), apresentado na interface como `M1`, `M2`, `M4`.

## Observação

Estas restrições **não devem voltar a ser hardcoded como fonte de verdade**. Elas ficam aqui somente para consulta durante a operação e para você reproduzir manualmente na configuração as exceções que realmente existirem fisicamente.