'use client';

import React from 'react';
import Link from 'next/link';
import { 
  ArrowRight, 
  Search, 
  Menu, 
  Bell, 
  Globe, 
  Layout, 
  PanelRight,
  Plus
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { 
  Popover, 
  PopoverContent, 
  PopoverTrigger 
} from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';

/**
 * WireframeShowcasePage
 * 
 * A standalone exploration page based on the provided wireframe design.
 * Features a sticky navigation bar, a glassmorphic popover, and a modern header.
 */
export default function WireframeShowcasePage() {
  return (
    <div className="min-h-screen bg-[#f8fafc] text-[#1e293b] font-sans selection:bg-[#e18131]/20">
      
      {/* 
        ROW 1: Navigation
        Dimensions: 710x72px (normalized for responsive layout)
        Sticky, top: 0, z-index: 50
      */}
      <nav className="sticky top-0 z-50 w-full bg-white/80 backdrop-blur-md border-b border-[#e2e8f0] h-[72px] flex items-center justify-center px-6">
        <div className="max-w-[1200px] w-full flex items-center justify-between">
          
          {/* Logo & Links */}
          <div className="flex items-center gap-10">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 bg-[#e18131] rounded-[10px] flex items-center justify-center text-white shadow-[0_4px_12px_rgba(225,129,49,0.2)]">
                <Globe size={20} strokeWidth={2.5} />
              </div>
              <span className="text-[20px] font-heading font-semibold tracking-tight text-[#0f172a]">
                Headhunt
              </span>
            </div>
            
            <div className="hidden md:flex items-center gap-8 text-[14px] font-medium text-[#64748b]">
              <a href="#" className="hover:text-[#0f172a] transition-colors">Platform</a>
              <a href="#" className="hover:text-[#0f172a] transition-colors">Agents</a>
              <a href="#" className="hover:text-[#0f172a] transition-colors">Security</a>
              <a href="#" className="hover:text-[#0f172a] transition-colors">Pricing</a>
            </div>
          </div>

          {/* Search bar helper (similar to dashboard) */}
          <div className="hidden lg:flex flex-1 max-w-[400px] mx-10 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8]" size={16} />
            <input 
              type="text" 
              placeholder="Search anything..." 
              className="w-full bg-[#f1f5f9] border-none rounded-full py-2 pl-10 pr-4 text-[13px] placeholder:text-[#94a3b8] focus:ring-1 focus:ring-[#cbd5e1] outline-none"
            />
          </div>

          {/* CTA & Actions */}
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="text-[14px] font-medium text-[#64748b] hidden sm:flex">
              Sign In
            </Button>
            <Button className="bg-[#0f172a] hover:bg-[#1e293b] text-white rounded-full px-6 h-10 text-[14px] font-semibold gap-2 shadow-sm transition-transform active:scale-95">
              Book Demo <ArrowRight size={15} />
            </Button>
          </div>
        </div>
      </nav>

      {/* Main Content Sections */}
      <main className="max-w-[1200px] mx-auto px-6 pt-20 pb-32 flex flex-col gap-24">
        
        {/*
          ROW 2: Popover Exploration
          Dimensions: 357x235px
          Content: Featured actions or information
        */}
        <div className="flex flex-col lg:flex-row items-center justify-between gap-16">
          <div className="flex-1 max-w-[500px]">
            <Badge className="bg-[#fff7ed] text-[#c2410c] border-[#ffedd5] uppercase tracking-wider px-3 py-1 mb-6 shadow-none">
              New Feature
            </Badge>
            <h1 className="text-[48px] md:text-[64px] font-heading font-semibold leading-[1.1] tracking-tight text-[#0f172a] mb-6">
              Agentic <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#e18131] to-[#f59e0b]">Hiring Loops</span>
            </h1>
            <p className="text-[18px] text-[#64748b] leading-relaxed mb-10">
              Coordinate multi-agent workflows with human-in-the-loop oversight. Secure, fast, and fully automated.
            </p>

            <div className="flex items-center gap-4">
               <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="rounded-full h-12 px-8 border-[#cbd5e1] hover:bg-white hover:border-[#94a3b8] shadow-sm text-[15px] font-semibold gap-2">
                    <Plus size={18} /> Click for Popover
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[357px] h-[235px] p-0 rounded-[24px] overflow-hidden border-[#dbe4ef] shadow-[0_20px_50px_rgba(15,23,42,0.1)] bg-white/95 backdrop-blur-xl">
                  <div className="h-full flex flex-col">
                    <div className="p-5 border-b border-[#f1f5f9] bg-gradient-to-br from-[#f8fafc] to-[#fff7ed]">
                      <div className="text-[12px] font-heading uppercase tracking-wider text-[#94a3b8]">Quick Actions</div>
                      <div className="text-[15px] font-medium text-[#334155] mt-1">Founding Hiring Pod</div>
                    </div>
                    <div className="flex-1 p-4 flex flex-col gap-3">
                      <div className="flex items-center gap-3 p-2.5 rounded-[12px] hover:bg-[#f8fafc] cursor-pointer group transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-[#eef2ff] text-[#4338ca] flex items-center justify-center"><Bell size={16} /></div>
                        <div className="flex-1">
                          <div className="text-[13px] font-medium text-[#334155]">Notification Policy</div>
                          <div className="text-[11px] text-[#94a3b8]">Set Guardian push rules</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 p-2.5 rounded-[12px] hover:bg-[#f8fafc] cursor-pointer group transition-colors">
                        <div className="w-8 h-8 rounded-lg bg-[#f0fdf4] text-[#16a34a] flex items-center justify-center"><Layout size={16} /></div>
                        <div className="flex-1">
                          <div className="text-[13px] font-medium text-[#334155]">Dashboard Layout</div>
                          <div className="text-[11px] text-[#94a3b8]">Customize your view</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>
              <Button className="rounded-full h-12 px-8 bg-[#e18131] hover:bg-[#c76922] text-white shadow-lg text-[15px] font-semibold">
                Get Started
              </Button>
            </div>
          </div>

          {/* 
            ROW 3: Header Section Sidebar
            Dimensions: 424x57px (represented as a card header here)
          */}
          <div className="relative">
            <div className="absolute -inset-4 bg-gradient-to-tr from-[#e18131]/10 to-[#f59e0b]/10 blur-2xl rounded-full" />
            <div className="relative w-full max-w-[424px] bg-white rounded-[32px] border border-[#dbe4ef] shadow-[0_20px_40px_rgba(15,23,42,0.08)] overflow-hidden">
              <div className="px-6 py-5 bg-[#fbfcfe] border-b border-[#f1f5f9] flex items-center justify-between">
                <div className="text-[16px] font-heading font-semibold text-[#0f172a]">Active Requisitions</div>
                <PanelRight size={18} className="text-[#94a3b8]" />
              </div>
              <div className="p-6 space-y-4">
                {[
                  { title: "Staff ML Engineer", team: "Platform", agents: 3 },
                  { title: "Senior Product Designer", team: "Design", agents: 2 },
                  { title: "Founding Engineer", team: "Core", agents: 4 }
                ].map((row, idx) => (
                  <div key={idx} className="flex items-center justify-between p-4 rounded-[16px] bg-[#f8fafc] border border-[#e2e8f0] hover:border-[#cbd5e1] transition-all group cursor-pointer">
                    <div>
                      <div className="text-[14px] font-medium text-[#334155]">{row.title}</div>
                      <div className="text-[11px] text-[#94a3b8] mt-0.5">{row.team}</div>
                    </div>
                    <Badge variant="secondary" className="bg-white border-[#cbd5e1] text-[#64748b] group-hover:bg-[#e18131] group-hover:text-white group-hover:border-[#e18131] transition-colors font-sans">
                      {row.agents} agents
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Floating elements to emphasize the modern look */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
           {[
             { title: "Secure Tunnels", desc: "Enterprise-grade Auth0 integration." },
             { title: "Low Latency", desc: "Global agent distribution nodes." },
             { title: "Hybrid Logic", desc: "Context-aware decision loops." }
           ].map((feat, i) => (
             <div key={i} className="p-8 rounded-[24px] bg-white border border-[#e2e8f0] shadow-sm hover:shadow-md transition-shadow">
               <div className="w-12 h-12 bg-[#f8fafc] rounded-[16px] flex items-center justify-center text-[#e18131] mb-6 shadow-inner">
                 <Globe size={24} />
               </div>
               <h3 className="text-[18px] font-heading font-semibold text-[#0f172a] mb-3">{feat.title}</h3>
               <p className="text-[14px] text-[#64748b] leading-relaxed">{feat.desc}</p>
             </div>
           ))}
        </div>
      </main>

      {/* Aesthetic Footer */}
      <footer className="border-t border-[#e2e8f0] bg-white py-12">
        <div className="max-w-[1200px] mx-auto px-6 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="text-[13px] text-[#94a3b8] font-sans">
            © 2026 Headhunt AI. All rights reserved. Built for the operator era.
          </div>
          <div className="flex items-center gap-8 text-[13px] font-medium text-[#64748b]">
            <a href="#" className="hover:text-[#0f172a]">Privacy Policy</a>
            <a href="#" className="hover:text-[#0f172a]">Terms of Service</a>
            <a href="#" className="hover:text-[#0f172a]">Status</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
