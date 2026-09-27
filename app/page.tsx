'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Clave para ingresar al sistema de Conserjería
const CLAVE_ACCESO = '1234';

interface Registro {
  id: string;
  patente: string;
  nombre_visita: string;
  rut_visita: string;
  depto_destino: string;
  fecha_ingreso: string;
  fecha_salida: string | null;
  monto_pagado: number;
  estado_pago: 'GRATIS' | 'PENDIENTE' | 'PAGADO';
  metodo_pago?: string | null;
}

function calcularTarifaActual(fechaIngresoStr: string) {
  if (!fechaIngresoStr) {
    return { monto: 0, horas: 0, minutos: 0, esGratis: true };
  }
  const ingreso = new Date(fechaIngresoStr);
  const ahora = new Date();
  const diffMilisegundos = Math.max(0, ahora.getTime() - ingreso.getTime());
  
  const horasTotales = Math.max(1, Math.ceil(diffMilisegundos / (1000 * 60 * 60)));
  const horasTranscurridas = Math.floor(diffMilisegundos / (1000 * 60 * 60));
  const minutosTranscurridos = Math.floor((diffMilisegundos % (1000 * 60 * 60)) / (1000 * 60));

  let monto = 0;
  if (horasTotales > 4) {
    const horasExtras = horasTotales - 4;
    monto = Math.min(horasExtras * 500, 5000);
  }

  return {
    monto,
    horas: horasTranscurridas,
    minutos: minutosTranscurridos,
    esGratis: horasTotales <= 4
  };
}

export default function ConsergeriaPage() {
  const [autenticado, setAutenticado] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [errorPassword, setErrorPassword] = useState('');

  const [registros, setRegistros] = useState<Registro[]>([]);
  const [patente, setPatente] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [depto, setDepto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | 'GRATIS' | 'PENDIENTE' | 'PAGADO'>('TODOS');
  const [pestañaActiva, setPestañaActiva] = useState<'ACTIVOS' | 'HISTORIAL'>('ACTIVOS');
  const [horaTurnoInicio, setHoraTurnoInicio] = useState('');
  const [cargando, setCargando] = useState(false);
  const [, setTick] = useState(0);

  // Verificar si hay sesión activa iniciada
  useEffect(() => {
    const sesionActiva = localStorage.getItem('sesion_conserje_activa');
    if (sesionActiva === 'true') {
      setAutenticado(true);
    }

    const horaGuardada = localStorage.getItem('horaTurnoInicio');
    if (horaGuardada) {
      setHoraTurnoInicio(horaGuardada);
    } else {
      const ahora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      setHoraTurnoInicio(ahora);
      localStorage.setItem('horaTurnoInicio', ahora);
    }
  }, []);

  const obtenerRegistros = async () => {
    try {
      const { data, error } = await supabase
        .from('registros_estacionamiento')
        .select('*')
        .order('fecha_ingreso', { ascending: false });

      if (error) {
        console.error('Error cargando datos:', error.message);
        return;
      }
      if (data) {
        setRegistros(data);
      }
    } catch (err) {
      console.error('Error de conexión:', err);
    }
  };

  useEffect(() => {
    if (!autenticado) return;

    obtenerRegistros();

    const timer = setInterval(() => setTick((t) => t + 1), 60000);

    const channel = supabase
      .channel('cambios_estacionamiento_ui')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registros_estacionamiento' }, () => {
        obtenerRegistros();
      })
      .subscribe();

    return () => {
      clearInterval(timer);
      supabase.removeChannel(channel);
    };
  }, [autenticado]);

  // Login
  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordInput === CLAVE_ACCESO) {
      setAutenticado(true);
      localStorage.setItem('sesion_conserje_activa', 'true');
      setErrorPassword('');
      setPasswordInput('');
    } else {
      setErrorPassword('Contraseña incorrecta. Intenta nuevamente.');
    }
  };

  // Logout / Cerrar Sesión
  const cerrarSesion = () => {
    if (confirm('¿Estás seguro de que deseas cerrar sesión / terminar el turno?')) {
      localStorage.removeItem('sesion_conserje_activa');
      const nuevaHora = new Date().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      localStorage.setItem('horaTurnoInicio', nuevaHora);
      setHoraTurnoInicio(nuevaHora);
      setAutenticado(false);
    }
  };

  // Registrar nuevo ingreso
  const registrarIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patente.trim() || !depto.trim()) {
      alert('Ingresa al menos la Patente y el Departamento.');
      return;
    }

    setCargando(true);
    const nuevoRegistro = {
      patente: patente.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      nombre_visita: nombre.trim() || 'Sin Nombre',
      rut_visita: rut.trim() || 'Sin RUT',
      depto_destino: depto.trim(),
      fecha_ingreso: new Date().toISOString()
    };

    const { error } = await supabase.from('registros_estacionamiento').insert([nuevoRegistro]);

    if (!error) {
      setPatente('');
      setNombre('');
      setRut('');
      setDepto('');
      await obtenerRegistros();
    } else {
      alert('Error de Supabase: ' + error.message);
    }
    setCargando(false);
  };

  const marcarComoPagado = async (registro: Registro, metodo: 'EFECTIVO' | 'TRANSFERENCIA') => {
    const tarifa = calcularTarifaActual(registro.fecha_ingreso);
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        estado_pago: 'PAGADO',
        monto_pagado: tarifa.monto,
        metodo_pago: metodo
      })
      .eq('id', registro.id);

    if (!error) obtenerRegistros();
    else alert('Error guardando pago: ' + error.message);
  };

  const marcarSalida = async (id: string) => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({ fecha_salida: new Date().toISOString() })
      .eq('id', id);

    if (!error) obtenerRegistros();
    else alert('Error marcando salida: ' + error.message);
  };

  // Vista de Login si no está autenticado
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-[#1a3b8b] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center space-y-6">
          <div className="text-5xl">🏢</div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">Control de Estacionamiento</h1>
            <p className="text-sm text-slate-500 mt-1">Ingresa el PIN de Conserjería</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              placeholder="Contraseña (Ej: 1234)"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full text-center tracking-widest text-2xl font-bold p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
              required
            />

            {errorPassword && (
              <p className="text-xs text-red-600 font-semibold">{errorPassword}</p>
            )}

            <button
              type="submit"
              className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-extrabold py-3.5 px-4 rounded-xl shadow transition-colors text-base"
            >
              Entrar al Sistema
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Totales
  const totalEfectivo = registros
    .filter((r) => r && r.estado_pago === 'PAGADO' && r.metodo_pago === 'EFECTIVO')
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalTransferencias = registros
    .filter((r) => r && r.estado_pago === 'PAGADO' && (r.metodo_pago === 'TRANSFERENCIA' || r.metodo_pago === 'WEBPAY' || r.metodo_pago === 'MERCADO_PAGO'))
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalRecaudado = totalEfectivo + totalTransferencias;

  const listaBase = registros.filter((r) => {
    if (!r) return false;
    return pestañaActiva === 'ACTIVOS' ? !r.fecha_salida : Boolean(r.fecha_salida);
  });

  const registrosFiltrados = listaBase.filter((r) => {
    const term = busqueda.toLowerCase();
    const coincideBusqueda =
      (r.patente && r.patente.toLowerCase().includes(term)) ||
      (r.depto_destino && r.depto_destino.toLowerCase().includes(term)) ||
      (r.nombre_visita && r.nombre_visita.toLowerCase().includes(term));

    const tarifa = calcularTarifaActual(r.fecha_ingreso);
    let estadoReal: 'GRATIS' | 'PENDIENTE' | 'PAGADO' = r.estado_pago || 'GRATIS';
    if (r.estado_pago !== 'PAGADO') {
      estadoReal = tarifa.esGratis ? 'GRATIS' : 'PENDIENTE';
    }

    const coincideEstado = filtroEstado === 'TODOS' || estadoReal === filtroEstado;

    return coincideBusqueda && coincideEstado;
  });

  return (
    <div className="min-h-screen bg-[#f1f4f9] p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto space-y-5">
        
        {/* Encabezado Azul */}
        <div className="bg-[#1a3b8b] text-white p-5 rounded-2xl flex flex-col md:flex-row justify-between items-start md:items-center shadow-md">
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              🏢 Control de Estacionamiento de Visitas
            </h1>
            <p className="text-blue-200 text-xs mt-1">Inicio Turno: {horaTurnoInicio} hrs</p>
          </div>
          <button
            onClick={cerrarSesion}
            className="mt-3 md:mt-0 bg-[#f59e0b] hover:bg-[#d97706] text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            🔒 Cerrar Sesión / Nuevo Turno
          </button>
        </div>

        {/* Tarjetas de Dinero */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#eefcf5] border border-[#a7f3d0] p-4 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-[#065f46] uppercase tracking-wider flex items-center gap-1">
              💵 TOTAL EFECTIVO TURNO
            </span>
            <p className="text-3xl font-black text-[#047857] mt-1">${totalEfectivo.toLocaleString('es-CL')}</p>
          </div>

          <div className="bg-[#faeefc] border border-[#f0abfc] p-4 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-[#701a75] uppercase tracking-wider flex items-center gap-1">
              🏛️ TOTAL TRANSFERENCIAS TURNO
            </span>
            <p className="text-3xl font-black text-[#86198f] mt-1">${totalTransferencias.toLocaleString('es-CL')}</p>
          </div>

          <div className="bg-[#eff6ff] border border-[#bfdbfe] p-4 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-[#1e40af] uppercase tracking-wider flex items-center gap-1">
              💰 TOTAL RECAUDADO TURNO
            </span>
            <p className="text-3xl font-black text-[#1d4ed8] mt-1">${totalRecaudado.toLocaleString('es-CL')}</p>
          </div>
        </div>

        {/* Pestañas */}
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setPestañaActiva('ACTIVOS')}
            className={`py-3 px-4 rounded-xl font-extrabold text-sm transition-all flex justify-center items-center gap-2 shadow-sm ${
              pestañaActiva === 'ACTIVOS'
                ? 'bg-[#2563eb] text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            🚗 Autos Estacionados (Activos)
          </button>
          <button
            onClick={() => setPestañaActiva('HISTORIAL')}
            className={`py-3 px-4 rounded-xl font-extrabold text-sm transition-all flex justify-center items-center gap-2 shadow-sm ${
              pestañaActiva === 'HISTORIAL'
                ? 'bg-[#2563eb] text-white'
                : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            📦 Historial de Salidas
          </button>
        </div>

        {/* Formulario */}
        {pestañaActiva === 'ACTIVOS' && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-base font-bold text-slate-800 mb-3">Registrar Nuevo Ingreso</h2>
            <form onSubmit={registrarIngreso} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
              <input
                type="text"
                placeholder="PATENTE (EJ: BBC)"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
                className="p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 uppercase font-semibold text-sm text-slate-800"
                required
              />
              <input
                type="text"
                placeholder="Nombre Visita"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800"
              />
              <input
                type="text"
                placeholder="RUT Visita"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                className="p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800"
              />
              <input
                type="text"
                placeholder="Depto / Casa"
                value={depto}
                onChange={(e) => setDepto(e.target.value)}
                className="p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800"
                required
              />
              <button
                type="submit"
                disabled={cargando}
                className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold py-3 px-4 rounded-xl shadow transition-colors text-sm cursor-pointer"
              >
                {cargando ? 'Guardando...' : '+ Ingresar Vehículo'}
              </button>
            </form>
          </div>
        )}

        {/* Filtros */}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Buscar por patente, depto o nombre..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm"
            />
          </div>

          <div className="flex gap-2">
            {(['TODOS', 'GRATIS', 'PENDIENTE', 'PAGADO'] as const).map((estado) => (
              <button
                key={estado}
                onClick={() => setFiltroEstado(estado)}
                className={`py-1.5 px-4 rounded-lg text-xs font-bold transition-colors ${
                  filtroEstado === estado
                    ? 'bg-[#0f172a] text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {estado}
              </button>
            ))}
          </div>
        </div>

        {/* Tabla */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100">
            <h2 className="text-base font-bold text-slate-800">
              {pestañaActiva === 'ACTIVOS' ? 'Vehículos Estacionados' : 'Historial de Salidas'}
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="p-3.5">Patente / Visita</th>
                  <th className="p-3.5">Depto</th>
                  <th className="p-3.5">Hora Llegada</th>
                  <th className="p-3.5">Tiempo Perm.</th>
                  <th className="p-3.5">Monto</th>
                  <th className="p-3.5">Estado Pago</th>
                  <th className="p-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {registrosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400 font-medium">
                      No hay registros disponibles.
                    </td>
                  </tr>
                ) : (
                  registrosFiltrados.map((reg) => {
                    const tarifa = calcularTarifaActual(reg.fecha_ingreso);
                    const estaPagado = reg.estado_pago === 'PAGADO';
                    const requierePago = !tarifa.esGratis && !estaPagado;
                    const horaLlegada = reg.fecha_ingreso
                      ? new Date(reg.fecha_ingreso).toLocaleTimeString('es-CL', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : '--:--';

                    return (
                      <tr key={reg.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5">
                          <div className="font-extrabold text-slate-800">{reg.patente}</div>
                          <div className="text-xs text-slate-400">{reg.nombre_visita || reg.rut_visita || '-'}</div>
                        </td>
                        <td className="p-3.5 font-bold text-slate-700">{reg.depto_destino}</td>
                        <td className="p-3.5 text-slate-600 font-medium">{horaLlegada} hrs</td>
                        <td className="p-3.5 text-slate-600 font-medium">
                          {tarifa.horas}h {tarifa.minutos}m
                        </td>
                        <td className="p-3.5 font-extrabold text-slate-800">
                          ${estaPagado ? (reg.monto_pagado || 0).toLocaleString('es-CL') : tarifa.monto.toLocaleString('es-CL')}
                        </td>
                        <td className="p-3.5">
                          {estaPagado ? (
                            <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800">
                              🟢 PAGADO ({reg.metodo_pago || 'GENERAL'})
                            </span>
                          ) : tarifa.esGratis ? (
                            <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-blue-100 text-blue-800">
                              🟢 GRATIS (0-4h)
                            </span>
                          ) : (
                            <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-red-100 text-red-800">
                              🔴 PENDIENTE
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-right space-x-1.5">
                          {pestañaActiva === 'ACTIVOS' && (
                            <>
                              {requierePago && (
                                <>
                                  <button
                                    onClick={() => marcarComoPagado(reg, 'EFECTIVO')}
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                  >
                                    Efectivo
                                  </button>
                                  <button
                                    onClick={() => marcarComoPagado(reg, 'TRANSFERENCIA')}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                                  >
                                    Transf.
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => marcarSalida(reg.id)}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                              >
                                Dar Salida
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}