# MBA Backend

## Estrutura
- `serverless.yml` na raiz define todas as funções Lambda.
- `services/agent`: lambda que orquestra chamadas ao OpenAI e invoca outras lambdas.
- `services/executar-sql`: lambda que executa queries via API Laravel.
- `services/schema-inspector`: lambda que inspeciona schema via JSON.

## Requisitos
- Node.js 20
- AWS CLI configurado localmente (opcional)
- AWS Secrets Manager com segredo `/myapp/credentials`

## Observações
- Atualize `dicionario_dados_negocio.json` em `services/schema-inspector` com seu schema real.