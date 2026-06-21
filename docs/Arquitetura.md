# Arquitetura do Sistema

## Aplicações

### Web Administrativo

Responsável por:

- Dashboard
- Busca
- Lançamentos
- Divergências
- Base de Dados
- Usuários

### App Produção (Futuro)

Responsável por:

- Consulta SKU
- Consulta Endereço
- Entrada
- Saída
- Inventário
- Produção

## Banco

Supabase

Tabelas:

- users
- slots
- history
- products
- divergencias
- paletizacao_import

## Estrutura Atual

App.tsx
InteractiveMapa.tsx
DashboardCards.tsx

## Estrutura Alvo

core/
services/
constants/
pages/
components/
drawers/
