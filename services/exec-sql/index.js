import mysql from "mysql2/promise";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });

async function getCreds() {
  const command = new GetSecretValueCommand({ SecretId: process.env.SECRET_NAME });
  const { SecretString } = await secretsClient.send(command);
  return JSON.parse(SecretString);
}

export const handler = async (event) => {
  const body = event.body ? JSON.parse(event.body) : event;
  const sql = body.sql;

  let cleanSql = sql.replace(/```sql|```/gi, "").trim();

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

    const [rows] = await connection.execute(sql);
    await connection.end();

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
