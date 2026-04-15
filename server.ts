import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { google } from "googleapis";
import fs from "fs";

// Load config for fallback
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const appConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};

// Initialize Firebase Admin with absolute certainty
let db: any;
try {
  if (!admin.apps.length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (rawServiceAccount) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch (e) {
        serviceAccount = JSON.parse(rawServiceAccount.replace(/\\n/g, '\n'));
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin: Initialized with Service Account");
    } else {
      admin.initializeApp({
        projectId: appConfig.projectId || "gen-lang-client-0493400479"
      });
      console.log("Firebase Admin: Initialized with Project ID (Fallback)");
    }
  }
  db = getFirestore(admin.app(), appConfig.firestoreDatabaseId || undefined);
} catch (error) {
  console.error("CRITICAL_FIREBASE_INIT_ERROR:", error);
}

// Helper for Google Sheets Auth
async function getSheetsClient() {
  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) return null;
    
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(rawServiceAccount);
    } catch (e) {
      serviceAccount = JSON.parse(rawServiceAccount.replace(/\\n/g, '\n'));
    }

    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error("SHEETS_AUTH_ERROR:", error);
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PLANS_SHEET_ID = "1fbtsbZOhGR7plw7kRDL3on4v4-MvkXXmKX-k_2pQN1w";
const ACCOUNTS_SHEET_ID = "1YsqLgZzHPjj_LP9NwYxTeE5X8E0El4Lnu5S5KpMJG2E";

// Debug endpoint to check connections
app.get("/api/debug", async (req, res) => {
  const status: any = {
    firebase: "Checking...",
    sheets: "Checking...",
    env: {
      hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      hasAbacateKey: !!process.env.ABACATE_PAY_API_KEY
    }
  };

  try {
    const testDoc = await db.collection("sales").limit(1).get();
    status.firebase = `OK (${testDoc.size} sales found)`;
  } catch (e: any) {
    status.firebase = `ERROR: ${e.message}`;
  }

  try {
    const sheets = await getSheetsClient();
    if (sheets) {
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: ACCOUNTS_SHEET_ID,
      });
      const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title) || [];
      
      try {
        const resp = await sheets.spreadsheets.values.get({
          spreadsheetId: ACCOUNTS_SHEET_ID,
          range: `'${sheetNames[0]}'!A1:D1`,
        });
        status.sheets = `OK (Sheet: "${sheetNames[0]}", Headers: ${resp.data.values?.[0]?.join(", ")})`;
      } catch (rangeError: any) {
        status.sheets = `RANGE_ERROR: ${rangeError.message} (Available sheets: ${sheetNames.join(", ")})`;
      }
    } else {
      status.sheets = "ERROR: No service account configured";
    }
  } catch (e: any) {
    status.sheets = `METADATA_ERROR: ${e.message}`;
  }

  res.json(status);
});

// API to fetch accounts from Sheet 1
app.get("/api/accounts", async (req, res) => {
  try {
    const sheetName = encodeURIComponent("BCs");
    const response = await axios.get(
      `https://docs.google.com/spreadsheets/d/${ACCOUNTS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`
    );
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
    });
    
    // Normalize keys to match frontend expectations
    const normalized = records.map((r: any) => ({
      User: r["Email outlook"] || r["User"],
      Senha: r["Senha"],
      Seguidores: r["Seguidores"] || "0",
      Curtidas: r["Curtidas"] || "0",
      Status: r["Status"]
    }));
    
    res.json(normalized);
  } catch (error: any) {
    console.error("Error fetching accounts:", error.message);
    res.status(500).json({ error: "Failed to fetch accounts", details: error.message });
  }
});

// API to fetch packages from the NEW Plans Sheet
app.get("/api/packages", async (req, res) => {
  try {
    const sheetName = encodeURIComponent("Página2");
    const response = await axios.get(
      `https://docs.google.com/spreadsheets/d/${PLANS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`
    );
    const records = parse(response.data, {
      columns: false,
      skip_empty_lines: true,
    });
    
    if (!Array.isArray(records) || records.length === 0) {
      return res.json([]);
    }

    const packages = [];
    const headers = records[0] || [];
    for (let i = 1; i < headers.length; i++) {
      if (!headers[i]) continue;
      packages.push({
        name: headers[i],
        profiles: records[1] && records[1][i] ? String(records[1][i]) : "0",
        accounts: records[2] && records[2][i] ? String(records[2][i]) : "0",
        price: records[3] && records[3][i] ? String(records[3][i]) : "0",
      });
    }
    
    res.json(packages);
  } catch (error: any) {
    console.error("Error fetching packages:", error.message);
    res.status(500).json({ error: "Failed to fetch packages", details: error.message });
  }
});

// Abacate Pay PIX generation
app.post("/api/pix/generate", async (req, res) => {
  const { amount, packageId, customer, userId } = req.body;
  
  if (!amount || !packageId || !customer || !userId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const numericAmount = parseFloat(String(amount));
  const apiKey = process.env.ABACATE_PAY_API_KEY;

  if (!apiKey) {
    console.error("CRITICAL: ABACATE_PAY_API_KEY is missing in environment variables.");
    return res.status(500).json({ 
      error: "Configuração do Servidor Incompleta", 
      details: "A chave de API da Abacate Pay não foi configurada. Por favor, adicione ABACATE_PAY_API_KEY às variáveis de ambiente da Vercel e faça um novo deploy." 
    });
  }

  try {
    const numericAmountCents = Math.round(numericAmount * 100);
    
    // Create a pending sale in Firestore first
    let saleRef;
    try {
      saleRef = db.collection("sales").doc();
    } catch (fsError: any) {
      console.error("FIRESTORE_INIT_ERROR:", fsError.message);
      return res.status(500).json({ error: "Erro ao acessar banco de dados", details: fsError.message });
    }
    const saleId = saleRef.id;

    // Using pixQrCode/create for direct PIX
    const pixData = {
      amount: numericAmountCents,
      expiresIn: 3600,
      description: `DominusScale - ${packageId}`.substring(0, 140),
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        cellphone: String(customer.phone).replace(/\D/g, ""),
        taxId: String(customer.taxId).replace(/\D/g, ""),
      },
      // Pass our internal saleId as metadata so we can identify it in the webhook
      metadata: {
        saleId: saleId,
        userId: userId,
        packageId: packageId
      }
    };

    console.log("ABACATE_PAY_DEBUG: Generating PIX for sale:", saleId);

    const response = await axios.post("https://api.abacatepay.com/v1/pixQrCode/create", pixData, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      timeout: 15000
    });

    const apiResponse = response.data;
    const data = apiResponse.data;
    
    if (!data || !data.brCode) {
      throw new Error("A API da Abacate Pay não retornou um código PIX válido.");
    }

    // Save the pending sale to Firestore
    await saleRef.set({
      userId,
      packageId,
      amount: numericAmount,
      status: "pending",
      pixCode: data.brCode,
      externalId: data.id,
      createdAt: new Date().toISOString(),
      customer: {
        name: customer.name,
        email: customer.email
      }
    });

    res.json({
      pixCode: data.brCode,
      qrCode: data.brCodeBase64,
      txId: data.id,
      saleId: saleId,
      isMock: false
    });
  } catch (error: any) {
    const errorData = error.response?.data;
    console.error("ABACATE_PAY_API_ERROR:", JSON.stringify(errorData, null, 2) || error.message);
    res.status(error.response?.status || 500).json({ 
      error: "Erro na Abacate Pay",
      details: errorData?.error || errorData?.message || error.message
    });
  }
});

// Webhook for Abacate Pay
app.post("/api/webhook/abacatepay", async (req, res) => {
  const event = req.body;
  console.log("WEBHOOK_RECEIVED:", JSON.stringify(event, null, 2));

  const isPaid = event.event === "billing.paid" || event.event === "pix.paid" || event.event === "billing.confirmed";
  
  if (isPaid) {
    const billingData = event.data;
    const saleIdFromMetadata = billingData.metadata?.saleId;
    const externalId = billingData.id;
    const pixId = billingData.pix?.id;

    try {
      let saleRef;
      let saleData;

      // 1. Try by metadata saleId
      if (saleIdFromMetadata) {
        console.log(`Trying lookup by metadata saleId: ${saleIdFromMetadata}`);
        const docRef = db.collection("sales").doc(saleIdFromMetadata);
        const snap = await docRef.get();
        if (snap.exists) {
          saleRef = docRef;
          saleData = snap.data();
        }
      }

      // 2. Try by externalId (billing ID)
      if (!saleData && externalId) {
        console.log(`Trying lookup by externalId: ${externalId}`);
        const q = await db.collection("sales").where("externalId", "==", externalId).limit(1).get();
        if (!q.empty) {
          saleRef = q.docs[0].ref;
          saleData = q.docs[0].data();
        }
      }

      // 3. Try by pixId
      if (!saleData && pixId) {
        console.log(`Trying lookup by pixId: ${pixId}`);
        const q = await db.collection("sales").where("externalId", "==", pixId).limit(1).get();
        if (!q.empty) {
          saleRef = q.docs[0].ref;
          saleData = q.docs[0].data();
        }
      }

      if (saleRef && saleData && saleData.status !== "paid") {
        console.log(`MATCH_FOUND: Processing payment for Sale ${saleRef.id}`);
        
        let accountsText = "Pagamento confirmado! Suas contas estão sendo preparadas.";
        
        try {
          const sheets = await getSheetsClient();
          if (sheets) {
            const sheetResponse = await sheets.spreadsheets.values.get({
              spreadsheetId: ACCOUNTS_SHEET_ID,
              range: "'BCs'!A:D",
            });

            const rows = sheetResponse.data.values || [];
            const headers = rows[0] || [];
            const emailIdx = headers.indexOf("Email outlook");
            const statusIdx = headers.indexOf("Status");
            const senhaIdx = headers.indexOf("Senha");

            if (emailIdx !== -1 && statusIdx !== -1) {
              let countToDeliver = 1;
              const pkgId = saleData.packageId || "";
              if (pkgId.includes("Pacote 1")) countToDeliver = 1;
              else if (pkgId.includes("Pacote 2")) countToDeliver = 3;
              else if (pkgId.includes("Pacote 3")) {
                const match = pkgId.match(/\d+/);
                if (match) countToDeliver = parseInt(match[0]);
              }

              const selectedRows = [];
              for (let i = 1; i < rows.length; i++) {
                if (selectedRows.length >= countToDeliver) break;
                const row = rows[i];
                if (row[statusIdx]?.trim().toLowerCase() === "à venda") {
                  selectedRows.push({ index: i + 1, User: row[emailIdx], Senha: row[senhaIdx] || "N/A" });
                }
              }

              if (selectedRows.length > 0) {
                for (const row of selectedRows) {
                  await sheets.spreadsheets.values.update({
                    spreadsheetId: ACCOUNTS_SHEET_ID,
                    range: `'BCs'!D${row.index}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [["vendida"]] }
                  });
                }
                accountsText = selectedRows.map(r => `User: ${r.User} | Senha: ${r.Senha}`).join("\n");
              }
            }
          }
        } catch (sheetErr: any) {
          console.error("SHEET_ERROR_BUT_CONFIRMING_SALE:", sheetErr.message);
        }

        await saleRef.update({
          status: "paid",
          paidAt: new Date().toISOString(),
          accounts: accountsText
        });
        console.log(`SALE_CONFIRMED: ${saleRef.id}`);
      } else {
        console.log("NO_MATCH_OR_ALREADY_PAID:", { saleIdFromMetadata, externalId, pixId });
      }
    } catch (error: any) {
      console.error("WEBHOOK_FATAL_ERROR:", error.message);
    }
  }
  res.sendStatus(200);
});

// SPA Handling
if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;

async function startServer() {
  const PORT = 3000;
  
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();
