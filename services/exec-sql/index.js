
import mysql from "mysql2/promise";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

async function getCreds() {
  const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
  const { SecretString } = await secretsClient.send(command);
  return JSON.parse(SecretString);
}

export const handler = async (event) => {
  let sql;

  try {
    const body = event.body ? JSON.parse(event.body) : event;
    sql = body.sql;
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Requisição malformada ou sem SQL." }),
    };
  }

  let cleanSql = sql
    .replace(/```sql/gi, "")  // remove início de bloco
    .replace(/```/g, "")      // remove fim de bloco
    .trim();

  if (!cleanSql || !/^\s*SELECT/i.test(cleanSql)) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Somente comandos SELECT são permitidos." }),
    };
  }

  try {
    const creds = await getCreds();
    const connection = await mysql.createConnection({
      host: creds.host,
      user: creds.user,
      password: creds.password,
      port: creds.port,
      database: creds.database
    });

    const [rows] = await connection.execute(cleanSql);
    await connection.end();

    console.log("Resultado SQL:", rows);

    return {
      statusCode: 200,
      body: JSON.stringify(rows),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};