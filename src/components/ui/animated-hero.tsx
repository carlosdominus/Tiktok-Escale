import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { MoveRight, PhoneCall, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

function Hero() {
  const [titleNumber, setTitleNumber] = useState(0);
  const titles = useMemo(
    () => ["Instantânea", "Segura", "Elite", "Automática", "Dominante"],
    []
  );

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      if (titleNumber === titles.length - 1) {
        setTitleNumber(0);
      } else {
        setTitleNumber(titleNumber + 1);
      }
    }, 2000);
    return () => clearTimeout(timeoutId);
  }, [titleNumber, titles]);

  return (
    <div className="w-full">
      <div className="container mx-auto">
        <div className="flex gap-8 py-20 lg:py-24 items-center justify-center flex-col text-white">
          <div>
            <Button variant="secondary" size="sm" className="gap-4 bg-white/10 hover:bg-white/20 text-cyan border border-white/10 rounded-full">
              Lançamento Dominus v2.0 <MoveRight className="w-4 h-4" />
            </Button>
          </div>
          <div className="flex gap-4 flex-col text-center">
            <h1 className="text-5xl md:text-8xl max-w-4xl tracking-tighter text-center font-bold font-sans">
              <span className="text-white">Escala sua operação com</span>
              <span className="relative flex w-full justify-center overflow-hidden text-center md:pb-4 md:pt-1">
                &nbsp;
                {titles.map((title, index) => (
                  <motion.span
                    key={index}
                    className="absolute font-black text-tiktok-red italic"
                    initial={{ opacity: 0, y: "-100" }}
                    transition={{ type: "spring", stiffness: 50 }}
                    animate={
                      titleNumber === index
                        ? {
                            y: 0,
                            opacity: 1,
                          }
                        : {
                            y: titleNumber > index ? -150 : 150,
                            opacity: 0,
                          }
                    }
                  >
                    {title}
                  </motion.span>
                ))}
              </span>
            </h1>

            <p className="text-lg md:text-xl leading-relaxed tracking-tight text-white/60 max-w-2xl text-center mx-auto mt-4 px-4">
              A maior plataforma de contas TikTok do Brasil. Perfis de alta qualidade, 
              entrega automática e suporte 24/7 para você focar no que importa: seu ROI.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-4 mt-8">
            <Button size="lg" className="gap-4 bg-tiktok-red hover:bg-tiktok-red/90 text-white rounded-full px-10 h-16 text-lg font-bold shadow-2xl shadow-tiktok-red/20" asChild>
              <a href="#produtos">
                Começar Escala <Zap className="w-5 h-5 fill-current" />
              </a>
            </Button>
            <Button size="lg" className="gap-4 variant-outline border-white/10 bg-white/5 text-white hover:bg-white/10 rounded-full px-10 h-16 text-lg font-bold shadow-2xl shadow-black/50" asChild>
                <a href="#seguranca">
                    Saber Mais <MoveRight className="w-5 h-5" />
                </a>
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export { Hero };
