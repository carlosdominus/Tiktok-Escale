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

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    let serviceAccount = null;
    
    if (rawServiceAccount) {
      // Handle potential newline issues in environment variables
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch (e) {
        // If it fails, try replacing escaped newlines
        serviceAccount = JSON.parse(rawServiceAccount.replace(/\\n/g, '\n'));
      }
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        databaseURL: `https://${serviceAccount.project_id}.firebaseio.com`
      });
      console.log("Firebase Admin initialized with service account.");
    } else {
      admin.initializeApp({
        projectId: appConfig.projectId || "gen-lang-client-0493400479"
      });
      console.log("Firebase Admin initialized with project ID fallback.");
    }
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
  }
}

// Ensure Firestore uses the correct database ID if provided in config
const db = getFirestore(admin.app(), appConfig.firestoreDatabaseId || undefined);

// Helper for Google Sheets Auth
async function getSheetsClient() {
  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
    ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
    : null;
    
  if (!serviceAccount) return null;

  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets']
  });
  
  return google.sheets({ version: 'v4', auth });
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PLANS_SHEET_ID = "1fbtsbZOhGR7plw7kRDL3on4v4-MvkXXmKX-k_2pQN1w";
const ACCOUNTS_SHEET_ID = "1YsqLgZzHPjj_LP9NwYxTeE5X8E0El4Lnu5S5KpMJG2E";

// API to fetch accounts from Sheet 1
app.get("/api/accounts", async (req, res) => {
  try {
    const sheetName = encodeURIComponent("Página1");
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

  // Handle both billing.paid and pix.paid
  if (event.event === "billing.paid" || event.event === "pix.paid") {
    const billingData = event.data;
    let saleId = billingData.metadata?.saleId;
    const externalId = billingData.id;

    try {
      let saleRef;
      let saleData;

      if (saleId) {
        saleRef = db.collection("sales").doc(saleId);
        const saleSnap = await saleRef.get();
        if (saleSnap.exists) {
          saleData = saleSnap.data();
        }
      }

      // Fallback: Search by externalId if saleId not in metadata or not found
      if (!saleData && externalId) {
        console.log(`Searching for sale with externalId: ${externalId}`);
        const salesQuery = await db.collection("sales").where("externalId", "==", externalId).limit(1).get();
        if (!salesQuery.empty) {
          saleRef = salesQuery.docs[0].ref;
          saleId = saleRef.id;
          saleData = salesQuery.docs[0].data();
        }
      }

      if (saleRef && saleData && saleData.status !== "paid") {
        console.log(`Processing payment for Sale ID: ${saleId}`);
        
        // 1. Fetch ALL accounts from sheet
        const sheets = await getSheetsClient();
        if (!sheets) throw new Error("Google Sheets client not initialized (check FIREBASE_SERVICE_ACCOUNT env var)");

        const sheetResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: ACCOUNTS_SHEET_ID,
          range: 'Página1!A:D',
        });

        const rows = sheetResponse.data.values || [];
        const headers = rows[0] || [];
        
        const emailIdx = headers.indexOf("Email outlook");
        const statusIdx = headers.indexOf("Status");
        const senhaIdx = headers.indexOf("Senha");

        if (emailIdx === -1 || statusIdx === -1) {
          throw new Error(`Colunas não encontradas na planilha. Cabeçalhos: ${headers.join(", ")}`);
        }

        // 2. Determine how many accounts to deliver
        let countToDeliver = 1;
        const pkgId = saleData.packageId || "";
        if (pkgId.includes("Pacote 1")) countToDeliver = 1;
        else if (pkgId.includes("Pacote 2")) countToDeliver = 3;
        else if (pkgId.includes("Pacote 3")) {
          const match = pkgId.match(/\d+/);
          if (match) countToDeliver = parseInt(match[0]);
        }

        // 3. Select available accounts
        const selectedRows: { index: number, data: any }[] = [];
        for (let i = 1; i < rows.length; i++) {
          if (selectedRows.length >= countToDeliver) break;
          
          const row = rows[i];
          const status = row[statusIdx]?.trim().toLowerCase();
          
          if (status === "à venda") {
            selectedRows.push({
              index: i + 1,
              data: {
                User: row[emailIdx],
                Senha: row[senhaIdx] || "N/A"
              }
            });
          }
        }

        if (selectedRows.length === 0) {
          console.error("ESTOQUE_ESGOTADO: Nenhuma conta 'à venda' encontrada.");
          await saleRef.update({
            status: "paid",
            paidAt: new Date().toISOString(),
            accounts: "ERRO: Estoque esgotado. Contate o suporte para entrega manual."
          });
        } else {
          // 4. Mark as "vendida" in Google Sheets
          console.log(`Marking ${selectedRows.length} accounts as sold in Sheets...`);
          for (const row of selectedRows) {
            await sheets.spreadsheets.values.update({
              spreadsheetId: ACCOUNTS_SHEET_ID,
              range: `Página1!D${row.index}`,
              valueInputOption: 'RAW',
              requestBody: {
                values: [["vendida"]]
              }
            });
          }

          const accountsText = selectedRows.map(r => `User: ${r.data.User} | Senha: ${r.data.Senha}`).join("\n");

          // 5. Update sale status
          await saleRef.update({
            status: "paid",
            paidAt: new Date().toISOString(),
            accounts: accountsText
          });
          console.log(`SUCCESS: Sale ${saleId} updated to PAID.`);
        }
      } else {
        console.log(`Sale not found or already paid. SaleId: ${saleId}, ExternalId: ${externalId}`);
      }
    } catch (error: any) {
      console.error("WEBHOOK_PROCESSING_ERROR:", error.message);
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
