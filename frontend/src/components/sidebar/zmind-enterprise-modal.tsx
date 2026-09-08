import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
  DialogTitle,
} from '@/components/ui/dialog';
import { useMediaQuery } from '@/hooks/use-media-query';
import Image from 'next/image';
import { useTheme } from 'next-themes';
import { Check, Sparkles } from 'lucide-react';
import { PricingSection } from '@/components/home/sections/pricing-section';

interface EnterpriseModalProps {
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ZmindEnterpriseModal({ 
  children,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange
}: EnterpriseModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isDesktop = useMediaQuery('(min-width: 768px)');
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === 'dark';

  // Use controlled or internal state
  const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
  const setOpen = controlledOnOpenChange || setInternalOpen;

  const benefits = [
    "Higher limits & more credits",
    "Premium AI models",
    "Faster responses",
    "Advanced tools & integrations",
    "Priority support"
  ];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {children}
      </DialogTrigger>
      <DialogContent className="p-0 gap-0 max-w-[88vw] lg:max-w-[74vw] xl:max-w-[64vw] rounded-xl overflow-hidden">
        <DialogTitle className="sr-only">
          Upgrade Membership
        </DialogTitle>
        <div className="grid grid-cols-1 lg:grid-cols-12 h-[560px] lg:h-[640px]">
          {/* Info Panel */}
          <div className="p-5 lg:p-6 xl:p-6 flex flex-col bg-card relative h-full overflow-y-auto border-r border-border lg:col-span-4 xl:col-span-3">
            <div className="relative z-10 flex flex-col h-full">
              <div className="mb-6 flex-shrink-0">
                <Image
                  src={isDarkMode ? '/zmind-logo-white.svg' : '/zmind-logo.svg'}
                  alt="Zmind Logo"
                  width={80}
                  height={28}
                  className="h-7 w-auto"
                />
              </div>

              <div className="mb-6 flex-shrink-0">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-gradient-to-r from-primary/10 to-secondary/10 border border-primary/20 mb-4">
                  <Sparkles className="w-3 h-3 text-primary" />
                  <span className="text-xs font-medium text-primary">Upgrade Membership</span>
                </div>
                
                <h2 className="text-2xl lg:text-2xl font-semibold tracking-tight mb-2 text-foreground">
                  Unlock more power with Plus
                </h2>
                <p className="text-sm lg:text-base text-muted-foreground mb-5 leading-relaxed">
                  Upgrade to get higher limits, premium models, faster responses, advanced tools, and priority support — everything you need to move faster.
                </p>
              </div>

              <div className="border-t border-border pt-5 flex-1">
                <h3 className="text-base font-semibold mb-3 text-foreground">Benefits</h3>
                <div className="space-y-3">
                  {benefits.map((benefit, index) => (
                    <div key={index} className="flex items-start gap-3">
                      <div className="flex-shrink-0 w-4 h-4 rounded-full bg-primary/20 flex items-center justify-center mt-0.5">
                        <Check className="w-3 h-3 text-primary" />
                      </div>
                      <p className="text-sm text-muted-foreground leading-relaxed">{benefit}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Pricing Panel */}
          <div className="bg-muted/20 h-full overflow-hidden lg:col-span-8 xl:col-span-9">
            <div className="h-full overflow-auto p-2 sm:p-4 md:p-5">
              <PricingSection 
                showTitleAndTabs={false}
                insideDialog={true}
                showInfo={false}
                variant="dashboard"
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Export with original name for backwards compatibility
export const ZmindProcessModal = ZmindEnterpriseModal;
