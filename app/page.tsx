'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

interface Registro {
  id: string;
  patente: string;
  nombre_visita: string;
  rut_visita: string;
  depto_destino: string;
  fecha_ingreso: string;
  fecha_salida?: string | null;
  monto_calculado: number;
  estado_pago: 'GRATIS' | 'PENDIENTE' | 'PAGADO';
  metodo_pago?: string;
}

export default function ConsergeriaPage() {
  // Estados para Sesión de Autenticación
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [authError, setAuthError] = useState('');

  // Control de Vistas: Activos o Historial
  const [vistaActual, setVistaActual] = useState<'ACTIVOS' | 'HISTORIAL'>('ACTIVOS');

  // Estados de Datos y Filtros
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | 'GRATIS' | 'PENDIENTE' | 'PAGADO'>('TODOS');

  // Formulario de Ingreso
  const [patente, setPatente] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [depto, setDepto] = useState('');

  // Verificar estado de sesión activa
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Cargar registros de Supabase
  const cargarRegistros = async () => {
    let query = supabase
      .from('registros_estacionamiento')
      .select('*');

    if (vistaActual === 'ACTIVOS') {
      // Autos que siguen en el condominio (sin fecha de salida)
      query = query.is('fecha_salida', null).order('fecha_ingreso', { ascending: false });
    } else {
      // Autos que ya se retiraron (con fecha de salida)
      query = query.not('fecha_salida', 'is', null).order('fecha_salida', { ascending: false });
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error al cargar datos:', error.message);
    } else if (data) {
      setRegistros(data);
    }
  };

  useEffect(() => {
    if (session) {
      cargarRegistros();
      const interval = setInterval(cargarRegistros, 10000); // Recargar cada 10 seg
      return () => clearInterval(interval);
    }
  }, [session, vistaActual]);

  // Manejador de Login
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setAuthError('Credenciales incorrectas. Revisa correo y contraseña.');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  // Cálculo de Tiempo y Tarifa
  const calcularTarifaYHoras = (fechaIngreso: string, fechaSalida?: string | null) => {
    const ingreso = new Date(fechaIngreso);
    const limite = fechaSalida ? new Date(fechaSalida) : new Date();
    const difMilisegundos = limite.getTime() - ingreso.getTime();
    const horasTotales = Math.max(1, Math.ceil(difMilisegundos / (1000 * 60 * 60)));

    let monto = 0;
    let esGratis = true;

    if (horasTotales > 4) {
      esGratis = false;
      const horasCobrabiles = horasTotales - 4;
      monto = Math.min(horasCobrabiles * 500, 5000);
    }

    const horas = Math.floor(difMilisegundos / (1000 * 60 * 60));
    const minutos = Math.floor((difMilisegundos % (1000 * 60 * 60)) / (1000 * 60));

    return { horasTotales, tiempoTexto: `${horas}h ${minutos}m`, monto, esGratis };
  };

  // Nuevo Ingreso
  const handleRegistrarIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patente || !depto) return;

    const { error } = await supabase.from('registros_estacionamiento').insert([
      {
        patente: patente.trim().toUpperCase(),
        nombre_visita: nombre.trim(),
        rut_visita: rut.trim(),
        depto_destino: depto.trim(),
        fecha_ingreso: new Date().toISOString(),
        monto_calculado: 0,
        estado_pago: 'GRATIS'
      }
    ]);

    if (error) {
      alert('Error al guardar en la base de datos: ' + error.message);
    } else {
      setPatente('');
      setNombre('');
      setRut('');
      setDepto('');
      cargarRegistros();
    }
  };

  // Acciones Rápidas
  const handleCobroEfectivo = async (id: string, monto: number) => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        estado_pago: 'PAGADO',
        monto_calculado: monto,
        metodo_pago: 'EFECTIVO'
      })
      .eq('id', id);

    if (error) alert('Error al registrar cobro: ' + error.message);
    cargarRegistros();
  };

  const handleMarcarSalida = async (id: string, montoCalculado: number) => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        fecha_salida: new Date().toISOString(),
        monto_calculado: montoCalculado
      })
      .eq('id', id);

    if (error) alert('Error al marcar salida: ' + error.message);
    cargarRegistros();
  };

  // Filtrado de Registros
  const registrosFiltrados = registros.filter((reg) => {
    const coincideBusqueda =
      reg.patente.toLowerCase().includes(busqueda.toLowerCase()) ||
      reg.depto_destino.toLowerCase().includes(busqueda.toLowerCase()) ||
      (reg.nombre_visita && reg.nombre_visita.toLowerCase().includes(busqueda.toLowerCase()));

    const tarifa = calcularTarifaYHoras(reg.fecha_ingreso, reg.fecha_salida);
    const estadoCalculado = reg.estado_pago === 'PAGADO' ? 'PAGADO' : tarifa.esGratis ? 'GRATIS' : 'PENDIENTE';

    const coincideFiltro = filtroEstado === 'TODOS' || estadoCalculado === filtroEstado;

    return coincideBusqueda && coincideFiltro;
  });

  // --- VISTA DE LOGIN SI NO HAY SESIÓN ---
  if (!session) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-slate-800 p-8 rounded-xl shadow-2xl max-w-md w-full border border-slate-700">
          <h1 className="text-2xl font-bold text-white text-center mb-2">🏢 Acceso Conserjería</h1>
          <p className="text-slate-400 text-sm text-center mb-6">Control de Estacionamientos de Visitas</p>

          {authError && <div className="bg-red-500/10 border border-red-500 text-red-400 p-3 rounded mb-4 text-sm">{authError}</div>}

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1">Correo Electrónico</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full bg-slate-700 border border-slate-600 rounded p-2.5 text-white focus:outline-none focus:border-blue-500"
                placeholder="conserje@condominio.cl"
              />
            </div>
            <div>
              <label className="block text-slate-300 text-sm font-medium mb-1">Contraseña</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full bg-slate-700 border border-slate-600 rounded p-2.5 text-white focus:outline-none focus:border-blue-500"
                placeholder="••••••••"
              />
            </div>
            <button type="submit" className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold p-3 rounded transition">
              Iniciar Sesión
            </button>
          </form>
        </div>
      </div>
    );
  }

  // --- VISTA PRINCIPAL (CONSERJERÍA AUTENTICADA) ---
  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* ENCABEZADO Y SESIÓN */}
        <div className="bg-white p-4 rounded-xl shadow-sm border flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">🏢 Panel de Conserjería</h1>
            <p className="text-slate-500 text-sm">Sesión activa: {session.user.email}</p>
          </div>
          <button onClick={handleLogout} className="bg-slate-200 hover:bg-slate-300 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium">
            Cerrar Sesión
          </button>
        </div>

        {/* NAVEGACIÓN DE VISTAS */}
        <div className="flex gap-4 border-b border-slate-200 pb-2">
          <button
            onClick={() => setVistaActual('ACTIVOS')}
            className={`px-4 py-2 font-bold text-sm rounded-lg transition ${
              vistaActual === 'ACTIVOS'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            🚗 Autos Estacionados (Activos)
          </button>
          <button
            onClick={() => setVistaActual('HISTORIAL')}
            className={`px-4 py-2 font-bold text-sm rounded-lg transition ${
              vistaActual === 'HISTORIAL'
                ? 'bg-blue-600 text-white shadow'
                : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            📜 Historial de Salidas
          </button>
        </div>

        {/* REGISTRO DE NUEVO INGRESO */}
        {vistaActual === 'ACTIVOS' && (
          <div className="bg-white p-6 rounded-xl shadow-sm border">
            <h2 className="text-lg font-bold text-slate-800 mb-4">➕ Registrar Ingreso de Vehículo</h2>
            <form onSubmit={handleRegistrarIngreso} className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <input
                type="text"
                placeholder="Patente (ej: BBCL10)"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
                required
                className="border rounded-lg p-2.5 text-slate-800 uppercase focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Depto Destino (ej: 402)"
                value={depto}
                onChange={(e) => setDepto(e.target.value)}
                required
                className="border rounded-lg p-2.5 text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="Nombre Visita"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="border rounded-lg p-2.5 text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="text"
                placeholder="RUT Visita"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                className="border rounded-lg p-2.5 text-slate-800 focus:ring-2 focus:ring-blue-500"
              />
              <button type="submit" className="bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg p-2.5">
                Ingresar Vehículo
              </button>
            </form>
          </div>
        )}

        {/* CONTROLES Y FILTROS */}
        <div className="bg-white p-4 rounded-xl shadow-sm border flex flex-col md:flex-row gap-4 justify-between items-center">
          <div className="w-full md:w-1/3">
            <input
              type="text"
              placeholder="🔍 Buscar por patente, depto o nombre..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full border rounded-lg p-2 text-slate-800"
            />
          </div>
          <div className="flex gap-2 w-full md:w-auto overflow-x-auto">
            {(['TODOS', 'GRATIS', 'PENDIENTE', 'PAGADO'] as const).map((estado) => (
              <button
                key={estado}
                onClick={() => setFiltroEstado(estado)}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  filtroEstado === estado
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {estado}
              </button>
            ))}
          </div>
        </div>

        {/* TABLA DE VEHÍCULOS */}
        <div className="bg-white rounded-xl shadow-sm border overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b text-slate-600 text-sm font-semibold">
                <th className="p-4">Patente</th>
                <th className="p-4">Depto</th>
                <th className="p-4">Visita</th>
                <th className="p-4">{vistaActual === 'ACTIVOS' ? 'Tiempo Transcurrido' : 'Tiempo Permanencia'}</th>
                <th className="p-4">Monto</th>
                <th className="p-4">Estado Pago</th>
                {vistaActual === 'ACTIVOS' && <th className="p-4 text-center">Acciones</th>}
              </tr>
            </thead>
            <tbody className="divide-y text-slate-800">
              {registrosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    {vistaActual === 'ACTIVOS'
                      ? 'No hay vehículos estacionados actualmente.'
                      : 'No hay registros en el historial de salidas.'}
                  </td>
                </tr>
              ) : (
                registrosFiltrados.map((reg) => {
                  const tarifa = calcularTarifaYHoras(reg.fecha_ingreso, reg.fecha_salida);
                  const estaPagado = reg.estado_pago === 'PAGADO';
                  const excedeGratis = !tarifa.esGratis && !estaPagado && vistaActual === 'ACTIVOS';

                  return (
                    <tr key={reg.id} className={excedeGratis ? 'bg-red-50/70' : 'hover:bg-slate-50'}>
                      <td className="p-4 font-bold text-lg">{reg.patente}</td>
                      <td className="p-4 font-semibold">{reg.depto_destino}</td>
                      <td className="p-4">{reg.nombre_visita || 'N/I'}</td>
                      <td className="p-4 font-medium">{tarifa.tiempoTexto}</td>
                      <td className="p-4 font-bold text-slate-900">${estaPagado ? reg.monto_calculado : tarifa.monto}</td>
                      <td className="p-4">
                        {estaPagado ? (
                          <span className="inline-flex items-center gap-1 bg-green-100 text-green-800 px-3 py-1 rounded-full text-xs font-bold">
                            🟢 PAGADO ({reg.metodo_pago || 'APP'})
                          </span>
                        ) : tarifa.esGratis ? (
                          <span className="inline-flex items-center gap-1 bg-blue-100 text-blue-800 px-3 py-1 rounded-full text-xs font-bold">
                            🟢 GRATIS
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-red-100 text-red-800 px-3 py-1 rounded-full text-xs font-bold">
                            🔴 PENDIENTE (❌)
                          </span>
                        )}
                      </td>
                      {vistaActual === 'ACTIVOS' && (
                        <td className="p-4 flex gap-2 justify-center">
                          {!estaPagado && !tarifa.esGratis && (
                            <button
                              onClick={() => handleCobroEfectivo(reg.id, tarifa.monto)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 rounded"
                            >
                              💵 Cobrar Efectivo
                            </button>
                          )}
                          <button
                            onClick={() => handleMarcarSalida(reg.id, tarifa.monto)}
                            className="bg-slate-700 hover:bg-slate-900 text-white text-xs font-bold px-3 py-1.5 rounded"
                          >
                            🚗 Marcar Salida
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

      </div>
    </div>
  );
}