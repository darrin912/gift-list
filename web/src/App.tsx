import { useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { setUnauthorizedHandler } from "./api";
import { useMe } from "./lib/queries";
import { SeasonProvider } from "./lib/season";
import { Loading } from "./components/ui";
import Layout from "./components/Layout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import GiftsPage from "./pages/GiftsPage";
import GiftFormPage from "./pages/GiftFormPage";
import PeoplePage from "./pages/PeoplePage";
import PersonPage from "./pages/PersonPage";
import PersonFormPage from "./pages/PersonFormPage";
import SettingsPage from "./pages/SettingsPage";

/** Sends the user to /login on any 401 and drops cached data. */
function UnauthorizedRedirect() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (window.location.pathname === "/login") return;
      qc.clear();
      navigate("/login", { replace: true, state: { from: window.location.pathname + window.location.search } });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate, qc, location.pathname]);
  return null;
}

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isLoading) return <div className="mx-auto max-w-5xl px-4"><Loading /></div>;
  if (!me.data) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  return (
    <SeasonProvider>
      <Outlet />
    </SeasonProvider>
  );
}

export default function App() {
  return (
    <>
      <UnauthorizedRedirect />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route element={<Layout />}>
            <Route index element={<DashboardPage />} />
            <Route path="gifts" element={<GiftsPage />} />
            <Route path="gifts/new" element={<GiftFormPage />} />
            <Route path="gifts/:id" element={<GiftFormPage />} />
            <Route path="people" element={<PeoplePage />} />
            <Route path="people/new" element={<PersonFormPage />} />
            <Route path="people/:id" element={<PersonPage />} />
            <Route path="people/:id/edit" element={<PersonFormPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Route>
      </Routes>
    </>
  );
}
