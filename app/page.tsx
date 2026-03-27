import OpticalNode from '@/components/OpticalNode';

export default function Home() {
  return (
    <main className="h-screen w-screen overflow-hidden bg-black text-emerald-500 font-mono selection:bg-emerald-900 selection:text-emerald-100">
      <OpticalNode />
    </main>
  );
}
