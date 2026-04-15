import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import axios from "axios";
import { 
  ShoppingCart, 
  ShieldCheck, 
  Zap, 
  CheckCircle2, 
  Copy, 
  QrCode, 
  ArrowRight,
  Package,
  Users,
  CreditCard,
  ExternalLink,
  LogOut,
  User as UserIcon,
  ShoppingBag,
  ArrowLeft,
  Download,
  Check
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast, Toaster } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import QRCode from "qrcode";
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, db, doc, setDoc, getDoc, updateDoc, collection, query, where, onSnapshot, orderBy } from "./firebase";
import { User } from "firebase/auth";

interface PackageData {
  name: string;
  profiles: string;
  accounts: string;
  price: string;
}

interface AccountData {
  "Email outlook": string;
  "Senha": string;
  "Senha tiktok": string;
  "Status": string;
}

export default function App() {
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<PackageData | null>(null);
  const [pixData, setPixData] = useState<{ pixCode: string; qrCode: string; isUrl?: boolean } | null>(null);
  const [isPixModalOpen, setIsPixModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [view, setView] = useState<"home" | "orders">("home");
  const [orders, setOrders] = useState<any[]>([]);
  const [isSuccessPage, setIsSuccessPage] = useState(window.location.pathname === "/success");
  const [customerData, setCustomerData] = useState({
    name: "",
    email: "",
    phone: "",
    taxId: ""
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [quantity, setQuantity] = useState(5);

  useEffect(() => {
    if (user && view === "orders") {
      const q = query(
        collection(db, "sales"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const ordersData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setOrders(ordersData);
      });
      
      return () => unsubscribe();
    }
  }, [user, view]);

  useEffect(() => {
    const handleLocationChange = () => {
      setIsSuccessPage(window.location.pathname === "/success");
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        // Sync user to Firestore
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            role: "user",
            createdAt: new Date().toISOString()
          });
          setCustomerData(prev => ({
            ...prev,
            name: currentUser.displayName || "",
            email: currentUser.email || ""
          }));
        } else {
          const data = userSnap.data();
          setCustomerData({
            name: data.customerName || data.displayName || currentUser.displayName || "",
            email: data.customerEmail || data.email || currentUser.email || "",
            phone: data.customerPhone || "",
            taxId: data.customerTaxId || ""
          });
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [pkgRes, accRes] = await Promise.all([
          axios.get("/api/packages"),
          axios.get("/api/accounts")
        ]);
        setPackages(Array.isArray(pkgRes.data) ? pkgRes.data : []);
        const allAccounts = Array.isArray(accRes.data) ? accRes.data : [];
        setAccounts(allAccounts.filter((acc: any) => acc.Status === "à venda"));
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Erro ao carregar informações. Tente novamente.");
      } finally {
        setLoading(false);
      }
    };
    loadInitialData();
  }, []);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success("Login realizado com sucesso!");
    } catch (error: any) {
      console.error("Login error:", error);
      const errorMessage = error.code === 'auth/unauthorized-domain' 
        ? "Domínio não autorizado no Firebase. Adicione tiktok-escale.vercel.app no console do Firebase."
        : `Erro ao fazer login: ${error.message}`;
      toast.error(errorMessage);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success("Sessão encerrada.");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleBuy = async (pkg: PackageData) => {
    if (!user) {
      toast.error("Você precisa estar logado para comprar.");
      handleLogin();
      return;
    }

    setSelectedPackage(pkg);
    setPixData(null);
    setIsPixModalOpen(true);
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 11) {
      return numbers
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2")
        .replace(/(-\d{4})\d+?$/, "$1");
    }
    return numbers;
  };

  const formatTaxId = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 11) {
      return numbers
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})/, "$1-$2")
        .replace(/(-\d{2})\d+?$/, "$1");
    }
    return numbers;
  };

  const generatePix = async () => {
    if (!selectedPackage || !user) return;
    
    if (!customerData.name || !customerData.email || !customerData.phone || !customerData.taxId) {
      toast.error("Por favor, preencha todos os campos.");
      return;
    }

    const cleanTaxId = customerData.taxId.replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      toast.error("CPF ou CNPJ inválido. Verifique os números.");
      return;
    }

    setIsGenerating(true);
    try {
      let priceValue = 0;
      
      if (selectedPackage.name === "Pacote 3") {
        priceValue = quantity * 140;
      } else {
        // Robust price parsing
        const cleanedPrice = selectedPackage.price.replace(/[^\d.,]/g, "");
        priceValue = cleanedPrice.includes(",") && cleanedPrice.indexOf(",") > cleanedPrice.indexOf(".") 
          ? parseFloat(cleanedPrice.replace(/\./g, "").replace(",", "."))
          : parseFloat(cleanedPrice.replace(/,/g, ""));
      }
      
      if (isNaN(priceValue) || priceValue <= 0) {
        toast.error("Erro ao processar o preço do pacote.");
        setIsGenerating(false);
        return;
      }

      console.log("DEBUG: Requesting PIX generation for", selectedPackage.name, "Amount:", priceValue);
      const response = await axios.post("/api/pix/generate", { 
        amount: priceValue, 
        packageId: selectedPackage.name === "Pacote 3" ? `Pacote 3 (${quantity} perfis)` : selectedPackage.name,
        customer: customerData,
        userId: user.uid
      });
      
      const data = response.data;
      console.log("DEBUG: PIX Response received:", data);

      // Save customer data to Firestore for future use
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          customerName: customerData.name,
          customerEmail: customerData.email,
          customerPhone: customerData.phone,
          customerTaxId: customerData.taxId
        });
      }
      
      // Handle PIX data response
      if (data.pixCode && data.pixCode.startsWith("http")) {
        console.log("DEBUG: Handling as Checkout URL");
        // For checkout URLs, we'll show a button to open it
        const qrCodeUrl = await QRCode.toDataURL(data.pixCode);
        setPixData({
          pixCode: data.pixCode,
          qrCode: qrCodeUrl,
          isUrl: true
        });
      } else if (data.pixCode) {
        console.log("DEBUG: Handling as Direct PIX");
        let qrCodeUrl = data.qrCode;
        
        // If the API didn't return a QR code image, generate one from the PIX code
        if (!qrCodeUrl) {
          console.log("DEBUG: Generating QR Code locally from pixCode");
          qrCodeUrl = await QRCode.toDataURL(data.pixCode);
        } else if (!qrCodeUrl.startsWith("data:")) {
          // Ensure base64 has the correct prefix
          qrCodeUrl = `data:image/png;base64,${qrCodeUrl}`;
        }
        
        setPixData({
          pixCode: data.pixCode,
          qrCode: qrCodeUrl,
          isUrl: false
        });
      } else {
        throw new Error("O servidor não retornou um código PIX válido.");
      }
    } catch (error: any) {
      console.error("CRITICAL: Error generating PIX:", error);
      const errorData = error.response?.data;
      const errorMsg = errorData?.details || errorData?.error || error.message || "Erro ao gerar pagamento. Tente novamente.";
      toast.error(errorMsg, { duration: 8000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyPixCode = () => {
    if (pixData?.pixCode) {
      navigator.clipboard.writeText(pixData.pixCode);
      toast.success("Código PIX copiado!");
    }
  };

  const availableAccountsCount = accounts.filter(a => a.Status === "à venda").length;

  if (isSuccessPage) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="max-w-md w-full bg-white rounded-[40px] p-12 shadow-2xl shadow-slate-200 text-center"
        >
          <div className="w-24 h-24 bg-emerald-100 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <CheckCircle2 className="w-12 h-12 text-emerald-500" />
          </div>
          <h1 className="text-3xl font-black text-slate-900 mb-4">Pagamento Confirmado!</h1>
          <p className="text-slate-500 mb-10 leading-relaxed">
            Seu pedido foi processado com sucesso. Em instantes você receberá os dados de acesso no seu e-mail e nesta tela.
          </p>
          
          <div className="bg-slate-50 p-6 rounded-3xl border border-slate-100 mb-10 text-left">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-4">Seus Acessos</p>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-white border border-slate-100 flex items-center justify-center">
                  <Zap className="w-4 h-4 text-emerald-500" />
                </div>
                <span className="text-sm font-medium text-slate-600">Aguardando liberação automática...</span>
              </div>
            </div>
          </div>

          <Button 
            variant="outline" 
            className="w-full h-14 rounded-2xl border-slate-200 text-slate-600 font-bold"
            onClick={() => {
              window.history.pushState({}, "", "/");
              setIsSuccessPage(false);
            }}
          >
            Voltar para Início
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FDFDFD] text-slate-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      <Toaster position="top-center" />
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 bg-emerald-500 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-200">
              <Zap className="text-white w-6 h-6 fill-current" />
            </div>
            <span className="text-xl font-bold tracking-tight text-slate-800">Dominus<span className="text-emerald-500">Scale</span></span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-500">
            <a href="#produtos" className="hover:text-emerald-600 transition-colors">Produtos</a>
            <a href="#seguranca" className="hover:text-emerald-600 transition-colors">Segurança</a>
            <a href="#suporte" className="hover:text-emerald-600 transition-colors">Suporte</a>
          </div>

          <div className="flex items-center gap-4">
            {user && (
              <Button 
                variant="ghost" 
                onClick={() => setView(view === "home" ? "orders" : "home")}
                className="text-slate-600 font-bold hover:text-emerald-600"
              >
                {view === "home" ? (
                  <><ShoppingBag className="w-5 h-5 mr-2" /> Meus Pedidos</>
                ) : (
                  <><ArrowLeft className="w-5 h-5 mr-2" /> Voltar</>
                )}
              </Button>
            )}
            {isAuthLoading ? (
              <Skeleton className="h-10 w-24 rounded-full" />
            ) : user ? (
              <div className="flex items-center gap-3">
                <div className="hidden sm:block text-right">
                  <p className="text-xs font-bold text-slate-800">{user.displayName}</p>
                  <p className="text-[10px] text-slate-500">{user.email}</p>
                </div>
                <Dialog>
                  <DialogTrigger 
                    render={
                      <Button variant="ghost" className="p-0 h-10 w-10 rounded-full overflow-hidden border border-slate-100">
                        <img src={user.photoURL || ""} alt="User" className="w-full h-full object-cover" />
                      </Button>
                    }
                  />
                  <DialogContent className="sm:max-w-[300px] rounded-3xl">
                    <div className="flex flex-col items-center gap-4 py-4">
                      <img src={user.photoURL || ""} alt="User" className="w-20 h-20 rounded-full border-4 border-emerald-50" />
                      <div className="text-center">
                        <p className="font-bold">{user.displayName}</p>
                        <p className="text-sm text-slate-500">{user.email}</p>
                      </div>
                      <Button variant="destructive" className="w-full rounded-xl gap-2" onClick={handleLogout}>
                        <LogOut className="w-4 h-4" /> Sair
                      </Button>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            ) : (
              <Button onClick={handleLogin} className="rounded-full bg-slate-900 hover:bg-slate-800 text-white gap-2">
                <UserIcon className="w-4 h-4" /> Entrar
              </Button>
            )}
          </div>
        </div>
      </nav>

      <main>
        {view === "home" ? (
          <>
            {/* Hero Section */}
            <section className="relative pt-20 pb-32 overflow-hidden">
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="max-w-3xl"
            >
              <Badge variant="secondary" className="mb-6 bg-emerald-50 text-emerald-700 hover:bg-emerald-50 border-none px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider">
                Plataforma Premium de Contas
              </Badge>
              <h1 className="text-6xl md:text-7xl font-extrabold tracking-tight text-slate-900 leading-[1.1] mb-8">
                Escala seu negócio com <span className="text-emerald-500">contas de elite.</span>
              </h1>
              <p className="text-xl text-slate-500 leading-relaxed mb-10 max-w-2xl">
                Acesso instantâneo a perfis de alta qualidade para TikTok e Outlook. 
                Entrega automática via PIX em menos de 30 segundos.
              </p>
              <div className="flex flex-col sm:flex-row gap-4">
                <a 
                  href="#produtos" 
                  className={cn(
                    buttonVariants({ size: "lg" }), 
                    "bg-emerald-500 hover:bg-emerald-600 text-white rounded-full px-8 h-14 text-lg shadow-xl shadow-emerald-200/50 group"
                  )}
                >
                  Ver Pacotes <ArrowRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
                </a>
                <div className="flex items-center gap-4 px-4">
                  <div className="flex -space-x-3">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="w-10 h-10 rounded-full border-2 border-white bg-slate-100 overflow-hidden">
                        <img src={`https://picsum.photos/seed/user${i}/100/100`} alt="User" referrerPolicy="no-referrer" />
                      </div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <p className="font-bold text-slate-800">+2.500 clientes</p>
                    <p className="text-slate-500">confiam na Dominus</p>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
          
          {/* Background Decoration */}
          <div className="absolute top-0 right-0 w-1/2 h-full bg-gradient-to-l from-emerald-50/50 to-transparent -z-10" />
          <div className="absolute -top-24 -right-24 w-96 h-96 bg-emerald-100/30 rounded-full blur-3xl -z-10" />
        </section>

        {/* Stats / Trust */}
        <section className="py-12 border-y border-slate-100 bg-slate-50/30">
          <div className="max-w-7xl mx-auto px-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
              {[
                { icon: Zap, label: "Entrega Instantânea", sub: "Após o PIX" },
                { icon: ShieldCheck, label: "Garantia de 7 dias", sub: "Segurança total" },
                { icon: Users, label: "Suporte VIP", sub: "24/7 disponível" },
                { icon: CheckCircle2, label: "Contas Verificadas", sub: "Qualidade elite" },
              ].map((item, i) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center">
                    <item.icon className="w-6 h-6 text-emerald-500" />
                  </div>
                  <div>
                    <p className="font-bold text-slate-800">{item.label}</p>
                    <p className="text-xs text-slate-500 uppercase tracking-wider font-medium">{item.sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Products Section */}
        <section id="produtos" className="py-32">
          <div className="max-w-7xl mx-auto px-6">
            <div className="flex flex-col md:flex-row md:items-end justify-between mb-16 gap-6">
              <div>
                <h2 className="text-4xl font-bold text-slate-900 mb-4">Escolha seu pacote</h2>
                <p className="text-slate-500 text-lg">Selecione a quantidade ideal para sua operação hoje.</p>
              </div>
              <div className="flex items-center gap-3 bg-slate-100 p-1 rounded-full">
                <Badge variant="outline" className="bg-white border-none shadow-sm px-4 py-2 rounded-full text-sm font-semibold text-emerald-600">
                  {availableAccountsCount} contas disponíveis
                </Badge>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <Card key={i} className="rounded-3xl border-slate-100 overflow-hidden">
                    <CardHeader className="p-8">
                      <Skeleton className="h-8 w-1/2 mb-4" />
                      <Skeleton className="h-4 w-full" />
                    </CardHeader>
                    <CardContent className="p-8 pt-0">
                      <Skeleton className="h-20 w-full mb-6" />
                      <Skeleton className="h-12 w-full rounded-full" />
                    </CardContent>
                  </Card>
                ))
              ) : Array.isArray(packages) && packages.length > 0 ? (
                packages.map((pkg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card className={`rounded-[32px] border-slate-100 transition-all duration-300 hover:shadow-2xl hover:shadow-emerald-100/50 hover:-translate-y-2 group relative overflow-hidden ${i === 1 ? 'ring-2 ring-emerald-500 shadow-xl shadow-emerald-100' : ''}`}>
                      {i === 1 && (
                        <div className="absolute top-0 right-0 bg-emerald-500 text-white px-6 py-1.5 rounded-bl-2xl text-xs font-bold uppercase tracking-widest">
                          Mais Popular
                        </div>
                      )}
                      <CardHeader className="p-10 pb-6">
                        <CardTitle className="text-2xl font-bold text-slate-800 mb-2">{pkg.name}</CardTitle>
                        <CardDescription className="text-slate-500 font-medium">
                          {pkg.name === "Pacote 3" ? "Ideal para grandes operações" : (pkg.profiles === "1" ? "Ideal para iniciantes" : "Ideal para escala rápida")}
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="p-10 pt-0">
                        <div className="flex items-baseline gap-1 mb-8">
                          <span className="text-4xl font-black text-slate-900">
                            R$ {pkg.name === "Pacote 3" ? (quantity * 140).toLocaleString('pt-BR') : pkg.price}
                          </span>
                          <span className="text-slate-400 font-medium">/total</span>
                        </div>
                        
                        {pkg.name === "Pacote 3" && (
                          <div className="mb-8 p-4 bg-slate-50 rounded-2xl border border-slate-100">
                            <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-3">
                              Quantidade de Perfis (mín. 5)
                            </label>
                            <div className="flex items-center gap-4">
                              <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-10 w-10 rounded-xl"
                                onClick={() => setQuantity(Math.max(5, quantity - 1))}
                              >
                                -
                              </Button>
                              <span className="text-xl font-bold text-slate-800 w-8 text-center">{quantity}</span>
                              <Button 
                                variant="outline" 
                                size="icon" 
                                className="h-10 w-10 rounded-xl"
                                onClick={() => setQuantity(quantity + 1)}
                              >
                                +
                              </Button>
                              <span className="text-xs text-slate-400 ml-auto">R$ 140 / perfil</span>
                            </div>
                          </div>
                        )}

                        <div className="space-y-4 mb-10">
                          <div className="flex items-center gap-3 text-slate-600">
                            <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </div>
                            <span className="font-medium">
                              {pkg.name === "Pacote 3" ? `${quantity} Perfis Completos` : `${pkg.profiles} Perfis Completos`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-slate-600">
                            <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </div>
                            <span className="font-medium">
                              {pkg.name === "Pacote 3" ? `${quantity * 90} Contas no total` : `${pkg.accounts} Contas no total`}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-slate-600">
                            <div className="w-6 h-6 rounded-full bg-emerald-50 flex items-center justify-center">
                              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                            </div>
                            <span className="font-medium">Acesso Outlook + TikTok</span>
                          </div>
                        </div>

                        <Button 
                          onClick={() => handleBuy(pkg)}
                          className={`w-full h-14 rounded-2xl text-lg font-bold transition-all ${i === 1 ? 'bg-emerald-500 hover:bg-emerald-600 text-white' : 'bg-slate-900 hover:bg-slate-800 text-white'}`}
                        >
                          Comprar Agora
                        </Button>
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              ) : (
                <div className="col-span-3 text-center py-20 text-slate-400">
                  Nenhum pacote disponível no momento.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Security Section */}
        <section id="seguranca" className="py-32 bg-slate-900 text-white overflow-hidden relative">
          <div className="max-w-7xl mx-auto px-6 relative z-10">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-20 items-center">
              <div>
                <Badge className="bg-emerald-500/20 text-emerald-400 border-none mb-6">Segurança Máxima</Badge>
                <h2 className="text-5xl font-bold mb-8 leading-tight">Sua operação em boas mãos.</h2>
                <div className="space-y-8">
                  {[
                    { title: "Criptografia de Ponta", desc: "Seus dados e acessos são protegidos com os mais altos padrões de segurança digital." },
                    { title: "Verificação Manual", desc: "Cada conta passa por um processo rigoroso de validação antes de ser listada." },
                    { title: "Entrega Automatizada", desc: "Sem espera. O sistema libera seus acessos no momento em que o PIX é confirmado." },
                  ].map((item, i) => (
                    <div key={i} className="flex gap-6">
                      <div className="w-14 h-14 rounded-2xl bg-white/5 flex-shrink-0 flex items-center justify-center border border-white/10">
                        <ShieldCheck className="w-8 h-8 text-emerald-500" />
                      </div>
                      <div>
                        <h4 className="text-xl font-bold mb-2">{item.title}</h4>
                        <p className="text-slate-400 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="relative">
                <div className="aspect-square bg-emerald-500/10 rounded-[64px] border border-emerald-500/20 flex items-center justify-center p-12">
                  <div className="w-full h-full bg-slate-800 rounded-[48px] shadow-2xl border border-white/5 p-8 flex flex-col justify-between">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Zap className="w-6 h-6 text-emerald-500" />
                        </div>
                        <span className="font-bold">Dominus System</span>
                      </div>
                      <Badge className="bg-emerald-500 text-white">Ativo</Badge>
                    </div>
                    <div className="space-y-4">
                      <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          whileInView={{ width: "100%" }}
                          transition={{ duration: 2, repeat: Infinity }}
                          className="h-full bg-emerald-500" 
                        />
                      </div>
                      <p className="text-xs text-slate-500 font-mono">SCANNING_ACCOUNTS_INTEGRITY...</p>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Status</p>
                        <p className="text-emerald-400 font-bold">Protegido</p>
                      </div>
                      <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                        <p className="text-[10px] uppercase tracking-widest text-slate-500 mb-1">Uptime</p>
                        <p className="text-white font-bold">99.9%</p>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Decorative circles */}
                <div className="absolute -top-10 -right-10 w-40 h-40 bg-emerald-500/20 rounded-full blur-3xl" />
                <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-emerald-500/20 rounded-full blur-3xl" />
              </div>
            </div>
          </div>
        </section>

            {/* FAQ / Support */}
            <section id="suporte" className="py-32 bg-white">
              <div className="max-w-3xl mx-auto px-6 text-center">
                <h2 className="text-4xl font-bold text-slate-900 mb-6">Ainda tem dúvidas?</h2>
                <p className="text-slate-500 text-lg mb-12">Nossa equipe de especialistas está pronta para te ajudar a escalar sua operação.</p>
                <a 
                  href="https://wa.me/5500000000000" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className={cn(
                    buttonVariants({ variant: "outline", size: "lg" }),
                    "rounded-full px-10 h-14 border-slate-200 hover:bg-slate-50 text-slate-700 font-bold"
                  )}
                >
                  Falar com Suporte no WhatsApp
                </a>
              </div>
            </section>
          </>
        ) : (
          <div className="max-w-4xl mx-auto px-6 py-20 space-y-12">
            <div className="space-y-4">
              <h2 className="text-5xl font-black text-slate-900 tracking-tight">Meus Pedidos</h2>
              <p className="text-lg text-slate-500 font-medium">Acompanhe suas compras e acesse suas contas entregues.</p>
            </div>

            <div className="grid grid-cols-1 gap-6">
              {orders.length > 0 ? (
                orders.map((order) => (
                  <motion.div
                    key={order.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <Card className="overflow-hidden border-slate-100 hover:border-emerald-200 transition-all group">
                      <div className="p-8 flex flex-col md:flex-row md:items-center justify-between gap-8">
                        <div className="flex items-center gap-6">
                          <div className={`w-16 h-16 rounded-3xl flex items-center justify-center shrink-0 shadow-lg ${
                            order.status === "paid" ? "bg-emerald-500 text-white shadow-emerald-500/20" : 
                            order.status === "pending" ? "bg-amber-500 text-white shadow-amber-500/20" : "bg-slate-500 text-white"
                          }`}>
                            <ShoppingBag className="w-8 h-8" />
                          </div>
                          <div className="space-y-1">
                            <h3 className="text-2xl font-black text-slate-900">{order.packageId}</h3>
                            <div className="flex items-center gap-3">
                              <span className="text-sm text-slate-400 font-bold">
                                {new Date(order.createdAt).toLocaleDateString("pt-BR", {
                                  day: "2-digit",
                                  month: "2-digit",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </span>
                              <Badge className={`rounded-full px-3 py-0.5 text-[10px] font-black uppercase tracking-widest border-none ${
                                order.status === "paid" ? "bg-emerald-100 text-emerald-700" : 
                                order.status === "pending" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-700"
                              }`}>
                                {order.status === "paid" ? "Pago" : order.status === "pending" ? "Pendente" : "Expirado"}
                              </Badge>
                            </div>
                          </div>
                        </div>

                        <div className="flex flex-col md:items-end gap-3">
                          <p className="text-3xl font-black text-slate-900 tracking-tight">R$ {order.amount.toFixed(2)}</p>
                          {order.status === "paid" && order.accounts ? (
                            <Button 
                              size="sm"
                              className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-xl px-6"
                              onClick={() => {
                                const blob = new Blob([order.accounts], { type: 'text/plain' });
                                const url = window.URL.createObjectURL(blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `contas-${order.id}.txt`;
                                a.click();
                              }}
                            >
                              <Download className="w-4 h-4 mr-2" /> Baixar Contas
                            </Button>
                          ) : order.status === "pending" ? (
                            <Button 
                              size="sm"
                              variant="outline"
                              className="border-amber-200 text-amber-600 hover:bg-amber-50 font-bold rounded-xl px-6"
                              onClick={() => {
                                setPixData({
                                  pixCode: order.pixCode,
                                  qrCode: "", 
                                  isUrl: order.pixCode.startsWith("http")
                                });
                                setIsPixModalOpen(true);
                              }}
                            >
                              Ver PIX
                            </Button>
                          ) : null}
                        </div>
                      </div>
                      
                      {order.status === "paid" && order.accounts && (
                        <div className="px-8 pb-8">
                          <div className="bg-slate-50 rounded-[24px] p-6 border border-slate-100 space-y-4">
                            <div className="flex items-center justify-between">
                              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Suas Contas Entregues:</p>
                              <Button 
                                variant="ghost" 
                                size="sm" 
                                className="h-8 text-[10px] font-black uppercase tracking-widest text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                onClick={() => {
                                  navigator.clipboard.writeText(order.accounts);
                                  toast.success("Contas copiadas!");
                                }}
                              >
                                <Copy className="w-3 h-3 mr-1" /> Copiar Tudo
                              </Button>
                            </div>
                            <pre className="text-sm font-mono text-slate-600 whitespace-pre-wrap break-all bg-white p-4 rounded-xl border border-slate-100">
                              {order.accounts}
                            </pre>
                            <div className="flex items-center gap-2 text-emerald-600">
                              <Check className="w-4 h-4" />
                              <p className="text-xs font-bold">Contas validadas e prontas para uso.</p>
                            </div>
                          </div>
                        </div>
                      )}
                    </Card>
                  </motion.div>
                ))
              ) : (
                <div className="text-center py-32 space-y-6 bg-slate-50 rounded-[40px] border border-dashed border-slate-200">
                  <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mx-auto text-slate-300 shadow-sm">
                    <ShoppingBag className="w-12 h-12" />
                  </div>
                  <div className="space-y-2">
                    <p className="text-2xl font-black text-slate-900">Nenhum pedido encontrado</p>
                    <p className="text-slate-500 font-medium">Você ainda não realizou nenhuma compra em nossa plataforma.</p>
                  </div>
                  <Button 
                    onClick={() => setView("home")}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold rounded-2xl px-10 h-14 shadow-lg shadow-emerald-500/20"
                  >
                    Explorar Planos
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      <footer className="bg-slate-50 py-20 border-t border-slate-100">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row justify-between items-center gap-10">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center">
                <Zap className="text-white w-5 h-5 fill-current" />
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-800">Dominus<span className="text-emerald-500">Scale</span></span>
            </div>
            <p className="text-slate-400 text-sm">
              © 2024 DominusScale. Todos os direitos reservados.
            </p>
            <div className="flex items-center gap-6 text-slate-400 text-sm font-medium">
              <a href="#" className="hover:text-emerald-500 transition-colors">Termos</a>
              <a href="#" className="hover:text-emerald-500 transition-colors">Privacidade</a>
            </div>
          </div>
        </div>
      </footer>

      {/* PIX Modal */}
      <Dialog open={isPixModalOpen} onOpenChange={setIsPixModalOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[32px] p-0 overflow-hidden border-none shadow-2xl">
          <div className="bg-emerald-500 p-8 text-white">
            <DialogHeader>
              <DialogTitle className="text-2xl font-bold text-white">Finalizar Pagamento</DialogTitle>
              <DialogDescription className="text-emerald-100">
                Escaneie o QR Code ou copie o código PIX abaixo.
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="p-8 max-h-[70vh] overflow-y-auto">
            {!pixData ? (
              <div className="space-y-6">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Nome Completo</label>
                    <input 
                      type="text" 
                      value={customerData.name}
                      onChange={(e) => setCustomerData({...customerData, name: e.target.value})}
                      className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="Seu nome completo"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">E-mail</label>
                    <input 
                      type="email" 
                      value={customerData.email}
                      onChange={(e) => setCustomerData({...customerData, email: e.target.value})}
                      className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                      placeholder="seu@email.com"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">Telefone</label>
                      <input 
                        type="text" 
                        value={customerData.phone}
                        onChange={(e) => setCustomerData({...customerData, phone: formatPhone(e.target.value)})}
                        className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest">CPF</label>
                      <input 
                        type="text" 
                        value={customerData.taxId}
                        onChange={(e) => setCustomerData({...customerData, taxId: formatTaxId(e.target.value)})}
                        className="w-full h-12 rounded-xl border border-slate-200 px-4 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
                        placeholder="000.000.000-00"
                      />
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={generatePix}
                  disabled={isGenerating}
                  className="w-full h-14 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-lg font-bold shadow-lg shadow-emerald-500/20"
                >
                  {isGenerating ? "Gerando PIX..." : "Gerar Código PIX"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="relative">
                  <div className="bg-white p-4 rounded-[32px] shadow-sm border border-slate-100 flex items-center justify-center">
                    {pixData.qrCode ? (
                      <img src={pixData.qrCode} alt="QR Code PIX" className="w-48 h-48 object-contain" />
                    ) : (
                      <div className="w-48 h-48 bg-slate-50 rounded-2xl flex items-center justify-center text-slate-400 text-xs">
                        QR Code Indisponível
                      </div>
                    )}
                  </div>
                </div>

                <div className="w-full space-y-4">
                  {pixData.isUrl || pixData.pixCode.startsWith("http") ? (
                    <div className="space-y-4">
                      <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 text-center">
                        <p className="text-emerald-800 font-bold mb-2">Checkout Seguro Gerado</p>
                        <p className="text-emerald-600 text-sm">Clique no botão abaixo para abrir a página de pagamento oficial da Abacate Pay e concluir seu PIX.</p>
                      </div>
                      <Button 
                        className="w-full h-16 rounded-2xl bg-emerald-500 hover:bg-emerald-600 text-white text-xl font-black shadow-xl shadow-emerald-500/30 group"
                        onClick={() => window.open(pixData.pixCode, "_blank")}
                      >
                        PAGAR AGORA <ArrowRight className="ml-2 w-6 h-6 group-hover:translate-x-1 transition-transform" />
                      </Button>
                      <p className="text-[10px] text-center text-slate-400 uppercase tracking-widest font-bold">
                        Pagamento processado por Abacate Pay
                      </p>
                    </div>
                  ) : (
                    <div className="bg-slate-50 p-4 rounded-2xl border border-slate-100 flex items-center justify-between gap-4">
                      <div className="flex-1 overflow-hidden">
                        <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold mb-1">Código PIX (Copia e Cola)</p>
                        <p className="text-sm font-mono text-slate-600 truncate">
                          {pixData.pixCode}
                        </p>
                      </div>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-12 w-12 rounded-xl hover:bg-emerald-50 hover:text-emerald-600 shrink-0"
                        onClick={copyPixCode}
                      >
                        <Copy className="w-5 h-5" />
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center gap-3 p-4 bg-blue-50 rounded-2xl border border-blue-100">
                    <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                      <Zap className="w-5 h-5 text-blue-600" />
                    </div>
                    <p className="text-xs text-blue-700 font-medium leading-relaxed">
                      Após o pagamento, suas contas serão enviadas automaticamente para o seu e-mail e aparecerão aqui.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="p-8 pt-0">
            <Button 
              variant="outline" 
              className="w-full h-12 rounded-xl border-slate-200 text-slate-500"
              onClick={() => setIsPixModalOpen(false)}
            >
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
