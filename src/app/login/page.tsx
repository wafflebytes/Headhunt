import { ArrowRight01Icon, ShieldCheck } from '@hugeicons/core-free-icons';

import { HugeIcon } from '@/components/ui/huge-icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#f5f6f8] flex flex-col items-center justify-center p-4">
      <div className="flex flex-col items-center mb-10">
        <div className="w-[64px] h-[64px] rounded-[22px] bg-gradient-to-tr from-[#0f172a] to-[#334155] flex items-center justify-center mb-6 shadow-[0_8px_24px_rgba(15,23,42,0.2)] border border-white/5">
          <div className="w-7 h-7 bg-white rounded-[6px] shadow-sm"></div>
        </div>
        <h1 className="text-[36px] font-heading font-semibold tracking-tight text-[#111827] mb-2">NET.30</h1>
        <p className="text-[17px] text-[#64748b] font-sans font-medium text-center">
          The AI billing brain for high-velocity agencies
        </p>
      </div>

      <div className="w-full max-w-[380px] flex flex-col gap-3">
        <a href="/auth/login?prompt=login&max_age=0" className="w-full">
          <Button
            variant="outline"
            className="w-full bg-white h-[48px] rounded-[10px] border-[#e2e8f0] shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:bg-[#f8fafc] text-[14px] font-medium text-[#374151] flex items-center gap-3 transition-colors"
          >
            <HugeIcon icon={ShieldCheck} size={18} strokeWidth={2.2} />
            Continue with Auth0
          </Button>
        </a>

        <a href="/auth/login?screen_hint=signup&prompt=login&max_age=0&returnTo=/onboarding&reset_onboarding=1" className="w-full">
          <Button
            variant="outline"
            className="w-full bg-white h-[48px] rounded-[10px] border-[#e2e8f0] shadow-[0_1px_3px_rgba(0,0,0,0.02)] hover:bg-[#f8fafc] text-[14px] font-medium text-[#374151] flex items-center gap-3 transition-colors"
          >
            <HugeIcon icon={ArrowRight01Icon} size={18} strokeWidth={2.2} />
            Create a new account
          </Button>
        </a>

        <div className="flex items-center gap-3 py-3">
          <div className="flex-1 h-px bg-[#e2e8f0]"></div>
          <span className="text-[12px] font-sans text-[#94a3b8]">or</span>
          <div className="flex-1 h-px bg-[#e2e8f0]"></div>
        </div>

        <Input
          type="email"
          placeholder="your.email@agency.com"
          className="h-[52px] bg-white border-[#e2e8f0] text-[15px] font-sans rounded-[14px] placeholder:text-[#94a3b8] shadow-sm focus-visible:border-[#0f172a] focus-visible:shadow-[0_0_0_1px_#0f172a]"
        />

        <a href="/auth/login?screen_hint=signup&prompt=login&max_age=0&returnTo=/onboarding&reset_onboarding=1" className="w-full mt-2">
          <Button className="w-full h-[54px] rounded-[16px] bg-[#0f172a] hover:bg-[#1e293b] text-white text-[15px] font-bold flex items-center justify-center gap-2 shadow-[0_8px_20px_rgba(15,23,42,0.15)] transition-all active:scale-[0.98]">
            Continue <HugeIcon icon={ArrowRight01Icon} size={18} strokeWidth={2.2} />
          </Button>
        </a>

        <p className="text-center text-[12px] text-[#9ca3af] mt-8 max-w-[280px] mx-auto leading-relaxed font-sans pb-10">
          By continuing, you agree to our{' '}
          <a href="#" className="font-semibold text-[#64748b] hover:text-[#374151]">
            privacy policy
          </a>{' '}
          and{' '}
          <a href="#" className="font-semibold text-[#64748b] hover:text-[#374151]">
            terms of use
          </a>
          .
        </p>
      </div>
    </div>
  );
}
