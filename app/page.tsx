'use client';

import { useState, useEffect } from 'react';
import { supabase } from './lib/supabase';

interface Registro {
  id: string;
  patente: string;
  nombre_visita: string;
  rut_visita: string;
  depto_destino: string;
  fecha_ingreso: string;
  fecha_salida: string | null;
  monto_calculado?: number;
  estado_pago: 'GRATIS' | 'PENDIENTE' | 'PAGADO';
  metodo_pago?: string | null;
}

export default function ConsergeriaPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [patente, setPatente] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [depto, setDepto] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [vista, setVista] = useState<'ACTIVOS' | 'HISTORIAL'>('ACTIVOS');
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | 'GRATIS' | 'PENDIENTE' | 'PAGADO'>('TODOS');
  
  // Estado para la fecha del inicio del turno actual
  const [inicioTurno, setInicioTurno] = useState<string>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('inicio_turno') || new Date().toISOString();
    }
    return new Date().toISOString();
  });

  useEffect(() => {
    obtenerRegistros();

    const channel = supabase
      .channel('cambios_estacionamiento')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registros_estacionamiento' },
        () => obtenerRegistros()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const obtenerRegistros = async () => {
    const { data, error } = await supabase
      .from('registros_estacionamiento')
      .select('*')
      .order('fecha_ingreso', { ascending: false });

    if (!error && data) {
      setRegistros(data);
    }
  };

  const registrarIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patente || !depto) return;

    const { error } = await supabase.from('registros_estacionamiento').insert([
      {
        patente: patente.toUpperCase(),
        nombre_visita: nombre || 'Sin registro',
        rut_visita: rut || 'Sin RUT',
        depto_destino: depto,
      },
    ]);

    if (!error) {
      setPatente('');
      setNombre('');
      setRut('');
      setDepto('');
      obtenerRegistros();
    }
  };

  const cobrarManual = async (id: string, metodo: 'EFECTIVO' | 'TRANSFERENCIA') => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        estado_pago: 'PAGADO',
        metodo_pago: metodo,
      })
      .eq('id', id);

    if (!error) {
      obtenerRegistros();
    }
  };

  const marcarSalida = async (id: string) => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        fecha_salida: new Date().toISOString(),
      })
      .eq('id', id);

    if (!error) {
      obtenerRegistros();
    }
  };

  const reiniciarTurno = () => {
    if (confirm('¿Estás seguro de cerrar el turno actual? El balance de caja se reiniciará a $0 para el nuevo conserje.')) {
      const ahora = new Date().toISOString();
      setInicioTurno(ahora);
      if (typeof window !== 'undefined') {
        localStorage.setItem('inicio_turno', ahora);
      }
    }
  };

  const calcularTarifa = (fechaIngresoStr: string, fechaSalidaStr?: string | null) => {
    const ingreso = new Date(fechaIngresoStr);
    const fin = fechaSalidaStr ? new Date(fechaSalidaStr) : new Date();
    const diferenciaMs = fin.getTime() - ingreso.getTime();
    const minutosTotales = Math.floor(diferenciaMs / (1000 * 60));
    const horasTotales = Math.ceil(diferenciaMs / (1000 * 60 * 60));

    const horasString = `${Math.floor(minutosTotales / 60)}h ${minutosTotales % 60}m`;

    if (horasTotales <= 4) {
      return { monto: 0, esGratis: true, tiempoTexto: horasString };
    }

    const horasExtras = horasTotales - 4;
    const montoCalculado = Math.min(horasExtras * 500, 5000);
    return { monto: montoCalculado, esGratis: false, tiempoTexto: horasString };
  };

  // --- CÁLCULO DE BALANCE DE CAJA PARA EL TURNO ACTUAL ---
  const registrosDelTurno = registros.filter((reg) => new Date(reg.fecha_ingreso) >= new Date(inicioTurno));
  
  const totalEfectivo = registrosDelTurno
    .filter((reg) => reg.estado_pago === 'PAGADO' && reg.metodo_pago === 'EFECTIVO')
    .reduce((acc, reg) => acc + calcularTarifa(reg.fecha_ingreso, reg.fecha_salida).monto, 0);

  const totalTransferencia = registrosDelTurno
    .filter((reg) => reg.estado_pago === 'PAGADO' && reg.metodo_pago === 'TRANSFERENCIA')
    .reduce((acc, reg) => acc + calcularTarifa(reg.fecha_ingreso, reg.fecha_salida).monto, 0);

  const totalGeneral = totalEfectivo + totalTransferencia;

  const registrosSegunVista = registros.filter((reg) => {
    if (vista === 'ACTIVOS') return reg.fecha_salida === null;
    return reg.fecha_salida !== null;
  });

  const registrosFiltrados = registrosSegunVista.filter((reg) => {
    const coincideBusqueda =
      reg.patente.toLowerCase().includes(busqueda.toLowerCase()) ||
      reg.depto_destino.toLowerCase().includes(busqueda.toLowerCase()) ||
      (reg.nombre_visita && reg.nombre_visita.toLowerCase().includes(busqueda.toLowerCase()));

    const tarifa = calcularTarifa(reg.fecha_ingreso, reg.fecha_salida);
    let estadoActual = reg.estado_pago;
    if (estadoActual !== 'PAGADO' && tarifa.esGratis) {
      estadoActual = 'GRATIS';
    } else if (estadoActual !== 'PAGADO' && !tarifa.esGratis) {
      estadoActual = 'PENDIENTE';
    }

    const coincideFiltro =
      filtroEstado === 'TODOS' || estadoActual === filtroEstado;

    return coincideBusqueda && coincideFiltro;
  });

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-6 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Encabezado */}
        <header className="bg-blue-900 text-white p-6 rounded-xl shadow-md flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold">🏢 Control de Estacionamiento de Visitas</h1>
            <p className="text-blue-200 text-sm">
              Inicio Turno: {new Date(inicioTurno).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} hrs
            </p>
          </div>
          <button
            onClick={reiniciarTurno}
            className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold px-4 py-2 rounded-lg text-xs transition shadow-sm"
          >
            📋 Cerrar / Iniciar Nuevo Turno
          </button>
        </header>

        {/* TARJETAS DE BALANCE DE CAJA */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-emerald-50 border border-emerald-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-bold text-emerald-700 uppercase tracking-wide">💵 Total Efectivo Turno</div>
            <div className="text-2xl font-extrabold text-emerald-800 mt-1">${totalEfectivo.toLocaleString('es-CL')}</div>
          </div>
          <div className="bg-purple-50 border border-purple-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-bold text-purple-700 uppercase tracking-wide">🏦 Total Transferencias Turno</div>
            <div className="text-2xl font-extrabold text-purple-800 mt-1">${totalTransferencia.toLocaleString('es-CL')}</div>
          </div>
          <div className="bg-blue-50 border border-blue-200 p-4 rounded-xl shadow-sm">
            <div className="text-xs font-bold text-blue-700 uppercase tracking-wide">💰 Total Recaudado Turno</div>
            <div className="text-2xl font-extrabold text-blue-900 mt-1">${totalGeneral.toLocaleString('es-CL')}</div>
          </div>
        </div>

        {/* Pestañas de Navegación (Activos vs Historial) */}
        <div className="flex gap-3">
          <button
            onClick={() => setVista('ACTIVOS')}
            className={`flex-1 py-3 px-4 rounded-xl font-bold transition text-sm flex items-center justify-center gap-2 ${
              vista === 'ACTIVOS'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            🚗 Autos Estacionados (Activos)
          </button>
          <button
            onClick={() => setVista('HISTORIAL')}
            className={`flex-1 py-3 px-4 rounded-xl font-bold transition text-sm flex items-center justify-center gap-2 ${
              vista === 'HISTORIAL'
                ? 'bg-blue-600 text-white shadow-md'
                : 'bg-white text-slate-600 hover:bg-slate-200'
            }`}
          >
            📦 Historial de Salidas
          </button>
        </div>

        {/* Formulario Registro (solo visible en vista ACTIVOS) */}
        {vista === 'ACTIVOS' && (
          <div className="bg-white p-6 rounded-xl shadow-md">
            <h2 className="text-lg font-semibold mb-4 text-slate-700">Registrar Nuevo Ingreso</h2>
            <form onSubmit={registrarIngreso} className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <input
                type="text"
                placeholder="Patente (ej: BBCL10)"
                value={patente}
                onChange={(e) => setPatente(e.target.value)}
                className="p-3 border rounded-lg uppercase"
                required
              />
              <input
                type="text"
                placeholder="Nombre Visita"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="p-3 border rounded-lg"
              />
              <input
                type="text"
                placeholder="RUT Visita"
                value={rut}
                onChange={(e) => setRut(e.target.value)}
                className="p-3 border rounded-lg"
              />
              <input
                type="text"
                placeholder="Depto / Casa"
                value={depto}
                onChange={(e) => setDepto(e.target.value)}
                className="p-3 border rounded-lg"
                required
              />
              <button
                type="submit"
                className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-3 rounded-lg transition"
              >
                + Ingresar Vehículo
              </button>
            </form>
          </div>
        )}

        {/* Buscador y Filtros */}
        <div className="bg-white p-4 rounded-xl shadow-md space-y-3">
          <div className="relative">
            <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">🔍</span>
            <input
              type="text"
              placeholder="Buscar por patente, depto o nombre..."
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="w-full pl-10 p-3 border rounded-lg"
            />
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {(['TODOS', 'GRATIS', 'PENDIENTE', 'PAGADO'] as const).map((estado) => (
              <button
                key={estado}
                onClick={() => setFiltroEstado(estado)}
                className={`px-4 py-2 rounded-lg font-bold text-xs transition ${
                  filtroEstado === estado
                    ? 'bg-slate-900 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {estado}
              </button>
            ))}
          </div>
        </div>

        {/* Tabla de Control */}
        <div className="bg-white p-6 rounded-xl shadow-md overflow-x-auto">
          <h2 className="text-lg font-semibold mb-4 text-slate-700">
            {vista === 'ACTIVOS' ? 'Vehículos Estacionados' : 'Historial de Vehículos Retirados'}
          </h2>
          <table className="w-full text-left border-collapse min-w-[750px]">
            <thead>
              <tr className="border-b bg-slate-50 text-slate-600 text-sm">
                <th className="p-3">Patente / Visita</th>
                <th className="p-3">Depto</th>
                <th className="p-3">Hora Llegada</th>
                <th className="p-3">Tiempo Perm.</th>
                <th className="p-3">Monto</th>
                <th className="p-3">Estado Pago</th>
                <th className="p-3 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {registrosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-4 text-center text-slate-400">
                    No hay registros disponibles.
                  </td>
                </tr>
              ) : (
                registrosFiltrados.map((reg) => {
                  const tarifa = calcularTarifa(reg.fecha_ingreso, reg.fecha_salida);
                  const estaPagado = reg.estado_pago === 'PAGADO';
                  const horaLlegada = new Date(reg.fecha_ingreso).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });

                  return (
                    <tr key={reg.id} className="border-b hover:bg-slate-50">
                      <td className="p-3">
                        <div className="font-bold text-lg">{reg.patente}</div>
                        <div className="text-sm text-slate-600">{reg.nombre_visita}</div>
                        <div className="text-xs text-slate-400">{reg.rut_visita}</div>
                      </td>
                      <td className="p-3 font-semibold">{reg.depto_destino}</td>
                      <td className="p-3 text-sm font-medium text-slate-700">
                        🕒 {horaLlegada} hrs
                      </td>
                      <td className="p-3 text-sm text-slate-600 font-mono">
                        {tarifa.tiempoTexto}
                      </td>
                      <td className="p-3 font-bold text-base">
                        {tarifa.esGratis ? '$0' : `$${tarifa.monto}`}
                      </td>
                      <td className="p-3">
                        {estaPagado ? (
                          <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full inline-flex items-center gap-1">
                            🟢 PAGADO ✅
                            {reg.metodo_pago && (
                              <span className="text-[10px] text-green-700">({reg.metodo_pago})</span>
                            )}
                          </span>
                        ) : tarifa.esGratis ? (
                          <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1 rounded-full inline-block">
                            ⏳ GRATIS
                          </span>
                        ) : (
                          <span className="bg-red-100 text-red-800 text-xs font-bold px-3 py-1 rounded-full inline-flex items-center gap-1">
                            🔴 PENDIENTE (❌)
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {!estaPagado && !tarifa.esGratis && (
                            <>
                              <button
                                onClick={() => cobrarManual(reg.id, 'EFECTIVO')}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition flex items-center gap-1 shadow-sm"
                              >
                                💵 Cobrar Efectivo
                              </button>
                              <button
                                onClick={() => cobrarManual(reg.id, 'TRANSFERENCIA')}
                                className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-2 rounded-lg transition flex items-center gap-1 shadow-sm"
                              >
                                🏦 Cobrar Transf.
                              </button>
                            </>
                          )}
                          {vista === 'ACTIVOS' && (
                            <button
                              onClick={() => marcarSalida(reg.id)}
                              className="bg-slate-700 hover:bg-slate-800 text-white text-xs font-bold px-3 py-2 rounded-lg transition flex items-center gap-1 shadow-sm"
                            >
                              🚗 Marcar Salida
                            </button>
                          )}
                        </div>
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
  );
}