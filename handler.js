// handler.js
exports.handler = async (event) => {
    const body = JSON.parse(event.body || '{}');
    const pergunta = body.pergunta || "Nenhuma pergunta recebida.";
  
    // TODO: invocar LangChain + parser de schema
    return {
      statusCode: 200,
      body: JSON.stringify({ mensagem: "Pergunta recebida", pergunta })
    };
  };
  