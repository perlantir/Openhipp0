import { Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout.js';
import { Agents } from './pages/Agents.js';
import { Audit } from './pages/Audit.js';
import { Chat } from './pages/Chat.js';
import { Costs } from './pages/Costs.js';
import { Health } from './pages/Health.js';
import { Home } from './pages/Home.js';
import { Memory } from './pages/Memory.js';
import { Scheduler } from './pages/Scheduler.js';
import { Settings } from './pages/Settings.js';
import { Skills } from './pages/Skills.js';

/** Top-level routing. One <Route> per dashboard page per the Phase 7 spec. */
export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/chat" element={<Chat />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/memory" element={<Memory />} />
        <Route path="/skills" element={<Skills />} />
        <Route path="/scheduler" element={<Scheduler />} />
        <Route path="/health" element={<Health />} />
        <Route path="/costs" element={<Costs />} />
        <Route path="/audit" element={<Audit />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Layout>
  );
}
