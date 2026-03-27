import OpticalNode from '@/components/OpticalNode';
import { Shield, Users } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-black text-emerald-500 font-mono selection:bg-emerald-900 selection:text-emerald-100 p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between border-b border-emerald-900/50 pb-4">
          <div className="flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-400" />
            <div>
              <h1 className="text-xl font-bold tracking-widest text-emerald-400">LUMINA PROTOCOL</h1>
              <p className="text-xs text-emerald-600">PROOF-OF-ATTENTION NODE v1.0.4</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              NETWORK SYNCED
            </div>
            <div className="hidden md:flex items-center gap-2 text-emerald-700">
              <Users className="w-4 h-4" />
              <span>1,402 PEERS</span>
            </div>
          </div>
        </header>

        <OpticalNode />
      </div>
    </main>
  );
}
