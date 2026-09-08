import { ModernPricingSection } from '@/components/home/sections/modern-pricing-section';
import { FAQSection } from '@/components/home/sections/faq-section';
import { CTASection } from '@/components/home/sections/cta-section';
import { FooterSection } from '@/components/home/sections/footer-section';

export default function PricingPage() {
  return (
    <main className="flex flex-col items-center justify-center w-full pt-20">
      <div className="w-full divide-y divide-border">
        <ModernPricingSection className="py-20" />
        <FAQSection />
        <CTASection />
        <FooterSection />
      </div>
    </main>
  );
}
