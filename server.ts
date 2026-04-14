import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const PLANS_SHEET_ID = "1fbtsbZOhGR7plw7kRDL3on4v4-MvkXXmKX-k_2pQN1w";
  const ACCOUNTS_SHEET_ID = "1YsqLgZzHPjj_LP9NwYxTeE5X8E0El4Lnu5S5KpMJG2E";

  // API to fetch accounts from Sheet 1
  app.get("/api/accounts", async (req, res) => {
    try {
      const response = await axios.get(
        `https://docs.google.com/spreadsheets/d/${ACCOUNTS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Página1`
      );
      const records = parse(response.data, {
        columns: true,
        skip_empty_lines: true,
      });
      res.json(records);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  // API to fetch packages from the NEW Plans Sheet
  app.get("/api/packages", async (req, res) => {
    try {
      const response = await axios.get(
        `https://docs.google.com/spreadsheets/d/${PLANS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Página2`
      );
      const records = parse(response.data, {
        columns: false,
        skip_empty_lines: true,
      });
      
      const packages = [];
      const headers = records[0] || [];
      for (let i = 1; i < headers.length; i++) {
        if (!headers[i]) continue;
        packages.push({
          name: headers[i],
          profiles: records[1]?.[i] || "0",
          accounts: records[2]?.[i] || "0",
          price: records[3]?.[i] || "0",
        });
      }
      
      res.json(packages);
    } catch (error) {
      console.error("Error fetching packages:", error);
      res.status(500).json({ error: "Failed to fetch packages" });
    }
  });

  // Abacate Pay PIX generation
  app.post("/api/pix/generate", async (req, res) => {
    const { amount, packageId, customerEmail } = req.body;
    const apiKey = process.env.ABACATE_PAY_API_KEY;

    if (!apiKey) {
      // Fallback to mock if API key is missing
      const txId = Math.random().toString(36).substring(7).toUpperCase();
      const pixCode = `00020126580014BR.GOV.BCB.PIX0118carlos@dominus.site520400005303986540${amount.toFixed(2)}5802BR5913CARLOS DOMINUS6008BRASILIA62070503${txId}6304ABCD`;
      return res.json({ pixCode, txId, isMock: true });
    }

    try {
      const response = await axios.post("https://api.abacatepay.com/v1/billing/create", {
        frequency: "ONE_TIME",
        methods: ["PIX"],
        products: [{
          externalId: packageId,
          name: `Pacote: ${packageId}`,
          quantity: 1,
          priceUnit: Math.round(amount * 100), // in cents
        }],
        returnUrl: `${process.env.APP_URL || "http://localhost:3000"}/success`,
        completionUrl: `${process.env.APP_URL || "http://localhost:3000"}/success`,
        customerId: customerEmail,
      }, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        }
      });

      // Abacate Pay returns a billing object
      const billing = response.data.data;
      res.json({
        pixCode: billing.pix.copyAndPaste,
        qrCode: billing.pix.qrCode,
        txId: billing.id,
        isMock: false
      });
    } catch (error: any) {
      console.error("Abacate Pay Error:", error.response?.data || error.message);
      res.status(500).json({ error: "Failed to generate PIX via Abacate Pay" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
