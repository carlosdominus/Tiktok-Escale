import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";
import admin from "firebase-admin";

// Initialize Firebase Admin
if (!admin.apps.length) {
  try {
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT 
      ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT) 
      : null;

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("Firebase Admin initialized with service account.");
    } else {
      // Fallback for local development if project ID is available
      admin.initializeApp({
        projectId: "tiktok-escale" // Replace with your actual project ID if known
      });
      console.log("Firebase Admin initialized with project ID only.");
    }
  } catch (error) {
    console.error("Error initializing Firebase Admin:", error);
  }
}

const db = admin.firestore();

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
    res.json(records);
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
    const saleRef = db.collection("sales").doc();
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

  if (event.event === "billing.paid" || event.event === "pix.paid") {
    const billingData = event.data;
    const saleId = billingData.metadata?.saleId;

    if (saleId) {
      try {
        const saleRef = db.collection("sales").doc(saleId);
        const saleSnap = await saleRef.get();

        if (saleSnap.exists && saleSnap.data()?.status !== "paid") {
          const saleData = saleSnap.data();
          
          // 1. Fetch accounts from sheet
          const accountsResponse = await axios.get(
            `https://docs.google.com/spreadsheets/d/${ACCOUNTS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent("Página1")}`
          );
          const allAccounts = parse(accountsResponse.data, { columns: true, skip_empty_lines: true });
          
          // 2. Determine how many accounts to deliver
          // We'll try to parse the package name or use a default
          let countToDeliver = 1;
          if (saleData?.packageId.includes("Pacote 1")) countToDeliver = 1;
          else if (saleData?.packageId.includes("Pacote 2")) countToDeliver = 3;
          else if (saleData?.packageId.includes("Pacote 3")) {
            const match = saleData.packageId.match(/\d+/);
            if (match) countToDeliver = parseInt(match[0]);
          }

          // 3. Get available accounts (not already sold)
          const soldSalesSnap = await db.collection("sales").where("status", "==", "paid").get();
          const soldAccountsText = soldSalesSnap.docs.map(d => d.data().accounts || "").join("\n");
          
          const availableAccounts = allAccounts.filter((acc: any) => {
            const accText = `${acc.User}:${acc.Senha}`;
            return !soldAccountsText.includes(accText);
          });

          const selectedAccounts = availableAccounts.slice(0, countToDeliver);
          const accountsText = selectedAccounts.map((acc: any) => `User: ${acc.User} | Senha: ${acc.Senha} | Seguidores: ${acc.Seguidores}`).join("\n");

          // 4. Update sale status and deliver accounts
          await saleRef.update({
            status: "paid",
            paidAt: new Date().toISOString(),
            accounts: accountsText || "Nenhuma conta disponível no momento. Entre em contato com o suporte."
          });

          console.log(`Sale ${saleId} marked as PAID and delivered ${selectedAccounts.length} accounts.`);
        }
      } catch (error) {
        console.error("Error processing webhook:", error);
      }
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
