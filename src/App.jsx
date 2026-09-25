import { Navigate, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import Home from './pages/Home.jsx';
import Drivers from './pages/Drivers.jsx';
import Equipment from './pages/Equipment.jsx';
import Apps from './pages/Apps.jsx';
import Connections from './pages/Connections.jsx';
import Users from './pages/Users.jsx';
import Account from './pages/Account.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="drivers" element={<Drivers />} />
        <Route path="equipment" element={<Equipment />} />
        <Route path="apps" element={<Apps />} />
        <Route path="connections" element={<Connections />} />
        <Route path="users" element={<Users />} />
        <Route path="account" element={<Account />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
