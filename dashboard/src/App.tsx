import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { ImageGen } from './pages/ImageGen';
import { Compare } from './pages/Compare';
import { Embeddings } from './pages/Embeddings';
import { Providers } from './pages/Providers';
import { AddProvider } from './pages/AddProvider';
import { Logs } from './pages/Logs';
import { Settings } from './pages/Settings';
import { Combos } from './pages/Combos';
import { Quota } from './pages/Quota';
import VirtualKeys from './pages/VirtualKeys';
import Advanced from './pages/Advanced';

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/image-gen" element={<ImageGen />} />
          <Route path="/compare" element={<Compare />} />
          <Route path="/embeddings" element={<Embeddings />} />
          <Route path="/providers" element={<Providers />} />
          <Route path="/providers/add" element={<AddProvider />} />
          <Route path="/combos" element={<Combos />} />
          <Route path="/quota" element={<Quota />} />
          <Route path="/virtual-keys" element={<VirtualKeys />} />
          <Route path="/advanced" element={<Advanced />} />
          <Route path="/logs" element={<Logs />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
