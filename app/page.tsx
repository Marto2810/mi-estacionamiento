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
  fecha_salida: string | null;
  monto_pagado: number;
  estado_pago: 'GRATIS' | 'PENDIENTE' | 'PAGADO';
  metodo_pago?: string | null;
}

// Lógica de cálculo de tarifa
function calcularTarifaActual(fechaIngresoStr: string) {
  const ingreso = new Date(fechaIngresoStr);
  const ahora = new Date();
  const diffMilisegundos = Math.max(0, ahora.getTime() - ingreso.getTime());
  
  const horasTotales = Math.max(1, Math.ceil(diffMilisegundos / (1000 * 60 * 60)));
  const horasTranscurridas = Math.floor(diffMilisegundos / (1000 * 60 * 60));
  const minutosTranscurridos = Math.floor((diffMilisegundos % (1000 * 60 * 60)) / (1000 * 60));

  let monto = 0;
  if (horasTotales > 4) {
    const horasExtras = horasTotales - 4;
    monto = Math.min(horasExtras * 500, 5000); // $500 por hora extra, tope $5.000
  }

  return {
    monto,
    horas: horasTranscurridas,
    minutos: minutosTranscurridos,
    esGratis: horasTotales <= 4
  };
}

export default function ConsergeriaPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [patente, setPatente] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [depto, setDepto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | 'GRATIS' | 'PENDIENTE' | 'PAGADO'>('TODOS');
  const [pestañaActiva, setPestañaActiva] = useState<'ACTIVOS' | 'HISTORIAL'>('ACTIVOS');
  const [horaTurnoInicio, setHoraTurnoInicio] = useState('11:14');
  const [cargando, setCargando] = useState(false);
  const [, setTick] = useState(0);

  // Obtener registros desde Supabase
  const obtenerRegistros = async () => {
    const { data, error } = await supabase
      .from('registros_estacionamiento')
      .select('*')
      .order('fecha_ingreso', { ascending: false });

    if (!error && data) {
      setRegistros(data);
    }
  };

  useEffect(() => {
    // Establecer la hora inicial de la sesión
    const ahora = new Date();
    setHoraTurnoInicio(ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }));

    obtenerRegistros();

    // Actualizar tiempos cada 1 minuto
    const timer = setInterval(() => setTick((t) => t + 1), 60000);

    // Escuchar cambios en vivo en Supabase
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
  }, []);

  // Registrar nuevo ingreso
  const registrarIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patente || !depto) {
      alert('Ingresa al menos la Patente y el Departamento.');
      return;
    }

    setCargando(true);
    const nuevoRegistro = {
      patente: patente.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      nombre_visita: nombre,
      rut_visita: rut,
      depto_destino: depto,
      fecha_ingreso: new Date().toISOString(),
      estado_pago: 'GRATIS',
      monto_pagado: 0
    };

    const { error } = await supabase.from('registros_estacionamiento').insert([nuevoRegistro]);

    if (!error) {
      setPatente('');
      setNombre('');
      setRut('');
      setDepto('');
      obtenerRegistros();
    } else {
      alert('Error al registrar: ' + error.message);
    }
    setCargando(false);
  };

  // Marcar cobro manual (Efectivo o Transferencia)
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
  };

  // Marcar salida de un vehículo
  const marcarSalida = async (id: string) => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({ fecha_salida: new Date().toISOString() })
      .eq('id', id);

    if (!error) obtenerRegistros();
  };

  // Reiniciar/Cerrar turno
  const reiniciarTurno = () => {
    if (confirm('¿Estás seguro de que deseas iniciar un nuevo turno? La hora de inicio se actualizará.')) {
      const ahora = new Date();
      setHoraTurnoInicio(ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }));
    }
  };

  // Totales de Dinero
  const totalEfectivo = registros
    .filter((r) => r.estado_pago === 'PAGADO' && r.metodo_pago === 'EFECTIVO')
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalTransferencias = registros
    .filter((r) => r.estado_pago === 'PAGADO' && (r.metodo_pago === 'TRANSFERENCIA' || r.metodo_pago === 'WEBPAY' || r.metodo_pago === 'MERCADO_PAGO'))
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalRecaudado = totalEfectivo + totalTransferencias;

  // Filtrado de listas según pestaña, término de búsqueda y estado
  const listaBase = registros.filter((r) => (pestañaActiva === 'ACTIVOS' ? !r.fecha_salida : r.fecha_salida !== null));

  const registrosFiltrados = listaBase.filter((r) => {
    const coincideBusqueda =
      r.patente.toLowerCase().includes(busqueda.toLowerCase()) ||
      r.depto_destino.toLowerCase().includes(busqueda.toLowerCase()) ||
      (r.nombre_visita && r.nombre_visita.toLowerCase().includes(busqueda.toLowerCase()));

    const tarifa = calcularTarifaActual(r.fecha_ingreso);
    let estadoReal: 'GRATIS' | 'PENDIENTE' | 'PAGADO' = r.estado_pago;
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
            onClick={reiniciarTurno}
            className="mt-3 md:mt-0 bg-[#f59e0b] hover:bg-[#d97706] text-white text-xs font-bold py-2.5 px-4 rounded-lg shadow transition-colors flex items-center gap-1.5"
          >
            📋 Cerrar / Iniciar Nuevo Turno
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

        {/* Pestañas de Selección */}
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

        {/* Formulario de Registrar Nuevo Ingreso */}
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
                className="bg-[#2563eb] hover:bg-[#1d4ed8] text-white font-bold py-3 px-4 rounded-xl shadow transition-colors text-sm"
              >
                + Ingresar Vehículo
              </button>
            </form>
          </div>
        )}

        {/* Barra de Búsqueda y Filtros */}
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

        {/* Tabla Principal */}
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
                    const horaLlegada = new Date(reg.fecha_ingreso).toLocaleTimeString('es-CL', {
                      hour: '2-digit',
                      minute: '2-digit'
                    });

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
                          ${estaPagado ? reg.monto_pagado.toLocaleString('es-CL') : tarifa.monto.toLocaleString('es-CL')}
                        </td>
                        <td className="p-3.5">
                          {estaPagado ? (
                            <span className="inline-block px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800">
                              🟢 PAGADO ({reg.metodo_pago})
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
                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors"
                                  >
                                    Efectivo
                                  </button>
                                  <button
                                    onClick={() => marcarComoPagado(reg, 'TRANSFERENCIA')}
                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors"
                                  >
                                    Transf.
                                  </button>
                                </>
                              )}
                              <button
                                onClick={() => marcarSalida(reg.id)}
                                className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors"
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