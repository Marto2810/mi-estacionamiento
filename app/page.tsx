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

// Función para calcular la tarifa actual según las reglas del condominio
function calcularTarifaActual(fechaIngresoStr: string) {
  const ingreso = new Date(fechaIngresoStr);
  const ahora = new Date();
  const diffMilisegundos = ahora.getTime() - ingreso.getTime();
  
  const horasTotales = Math.max(1, Math.ceil(diffMilisegundos / (1000 * 60 * 60)));
  const horasTotalesTranscurridas = Math.floor(diffMilisegundos / (1000 * 60 * 60));
  const minutosTotalesTranscurridos = Math.floor((diffMilisegundos % (1000 * 60 * 60)) / (1000 * 60));

  let monto = 0;
  if (horasTotales > 4) {
    const horasExtras = horasTotales - 4;
    monto = Math.min(horasExtras * 500, 5000); // $500/hora extra, tope $5.000
  }

  return {
    monto,
    horas: horasTotalesTranscurridas,
    minutos: minutosTotalesTranscurridos,
    esGratis: horasTotales <= 4
  };
}

export default function ConsergeriaPage() {
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [patente, setPatente] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  const [depto, setDepto] = useState('');
  const [cargando, setCargando] = useState(false);
  const [, setTick] = useState(0);

  // Cargar datos desde Supabase
  const obtenerRegistros = async () => {
    const { data, error } = await supabase
      .from('registros_estacionamiento')
      .select('*')
      .order('fecha_ingreso', { ascending: false });

    if (error) {
      console.error('Error al obtener registros:', error.message);
    } else if (data) {
      setRegistros(data);
    }
  };

  useEffect(() => {
    obtenerRegistros();

    const timer = setInterval(() => {
      setTick((t) => t + 1);
    }, 60000);

    const channel = supabase
      .channel('cambios_estacionamiento')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'registros_estacionamiento' },
        () => {
          obtenerRegistros();
        }
      )
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
      alert('Por favor ingresa al menos la Patente y el Departamento.');
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

    if (error) {
      alert('Error al registrar vehículo: ' + error.message);
    } else {
      setPatente('');
      setNombre('');
      setRut('');
      setDepto('');
      obtenerRegistros();
    }
    setCargando(false);
  };

  // Marcar como pagado (Efectivo o Transferencia)
  const marcarComoPagado = async (registro: Registro, metodo: 'EFECTIVO' | 'TRANSFERENCIA') => {
    const tarifa = calcularTarifaActual(registro.fecha_ingreso);
    const montoPagar = tarifa.monto;

    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        estado_pago: 'PAGADO',
        monto_pagado: montoPagar,
        metodo_pago: metodo
      })
      .eq('id', registro.id);

    if (error) {
      alert('Error al actualizar el pago: ' + error.message);
    } else {
      obtenerRegistros();
    }
  };

  // Registrar salida
  const marcarSalida = async (id: string) => {
    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({ fecha_salida: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      alert('Error al registrar salida: ' + error.message);
    } else {
      obtenerRegistros();
    }
  };

  // Listas filtradas
  const autosActivos = registros.filter((r) => !r.fecha_salida);
  const historialSalidas = registros.filter((r) => r.fecha_salida !== null);

  // Totales por tipo de pago
  const totalEfectivo = registros
    .filter((r) => r.estado_pago === 'PAGADO' && r.metodo_pago === 'EFECTIVO')
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalTransferencias = registros
    .filter((r) => r.estado_pago === 'PAGADO' && (r.metodo_pago === 'TRANSFERENCIA' || r.metodo_pago === 'WEBPAY' || r.metodo_pago === 'MERCADO_PAGO'))
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalRecaudado = totalEfectivo + totalTransferencias;

  return (
    <div className="min-h-screen bg-slate-100 p-4 md:p-8 font-sans">
      <div className="max-w-6xl mx-auto space-y-6">
        
        {/* Encabezado y Métricas */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-6 rounded-xl shadow-sm border border-slate-200 gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-800">🏢 Estacionamiento de Visitas</h1>
            <p className="text-slate-500 text-sm">Control de acceso y cobros en tiempo real</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full md:w-auto">
            {/* Tarjeta Efectivo */}
            <div className="bg-emerald-50 border border-emerald-200 p-3.5 rounded-xl min-w-[150px]">
              <span className="text-xs font-bold text-emerald-800 uppercase tracking-wide">💵 TOTAL EFECTIVO TURNO</span>
              <p className="text-2xl font-extrabold text-emerald-700 mt-1">${totalEfectivo.toLocaleString('es-CL')}</p>
            </div>

            {/* Tarjeta Transferencias */}
            <div className="bg-purple-50 border border-purple-200 p-3.5 rounded-xl min-w-[150px]">
              <span className="text-xs font-bold text-purple-800 uppercase tracking-wide">🏛️ TOTAL TRANSFERENCIAS TURNO</span>
              <p className="text-2xl font-extrabold text-purple-700 mt-1">${totalTransferencias.toLocaleString('es-CL')}</p>
            </div>

            {/* Tarjeta Recaudado Total */}
            <div className="bg-blue-50 border border-blue-200 p-3.5 rounded-xl min-w-[150px]">
              <span className="text-xs font-bold text-blue-800 uppercase tracking-wide">💰 TOTAL RECAUDADO TURNO</span>
              <p className="text-2xl font-extrabold text-blue-700 mt-1">${totalRecaudado.toLocaleString('es-CL')}</p>
            </div>
          </div>
        </div>

        {/* Formulario de Nuevo Ingreso */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
          <h2 className="text-lg font-semibold text-slate-800 mb-4">➕ Registrar Nuevo Ingreso</h2>
          <form onSubmit={registrarIngreso} className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              type="text"
              placeholder="PATENTE (EJ: BBCL10)"
              value={patente}
              onChange={(e) => setPatente(e.target.value)}
              className="p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none uppercase font-semibold text-slate-800"
              required
            />
            <input
              type="text"
              placeholder="Depto / Casa"
              value={depto}
              onChange={(e) => setDepto(e.target.value)}
              className="p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-800"
              required
            />
            <input
              type="text"
              placeholder="Nombre Visita"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-800"
            />
            <input
              type="text"
              placeholder="RUT Visita"
              value={rut}
              onChange={(e) => setRut(e.target.value)}
              className="p-2.5 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-slate-800"
            />
            <button
              type="submit"
              disabled={cargando}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold p-2.5 rounded-lg transition-colors disabled:opacity-50"
            >
              {cargando ? 'Guardando...' : 'Ingresar Vehículo'}
            </button>
          </form>
        </div>

        {/* Tabla de Vehículos Estacionados */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-slate-800">🚗 Vehículos en el Condominio</h2>
            <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-full">
              {autosActivos.length} Activos
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <th className="p-3.5">PATENTE</th>
                  <th className="p-3.5">DEPTO</th>
                  <th className="p-3.5">VISITA / RUT</th>
                  <th className="p-3.5">HORA LLEGADA</th>
                  <th className="p-3.5">TIEMPO ESTACIONADO</th>
                  <th className="p-3.5">MONTO ACTUAL</th>
                  <th className="p-3.5">ESTADO PAGO</th>
                  <th className="p-3.5 text-right">ACCIONES</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {autosActivos.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-slate-400">
                      No hay vehículos estacionados en este momento.
                    </td>
                  </tr>
                ) : (
                  autosActivos.map((reg) => {
                    const tarifa = calcularTarifaActual(reg.fecha_ingreso);
                    const estaPagado = reg.estado_pago === 'PAGADO';
                    const requierePago = !tarifa.esGratis && !estaPagado;
                    const horaIngresoFormatted = new Date(reg.fecha_ingreso).toLocaleTimeString('es-CL', {
                      hour: '2-digit',
                      minute: '2-digit'
                    });

                    return (
                      <tr key={reg.id} className="hover:bg-slate-50">
                        <td className="p-3.5 font-bold text-slate-800 text-base">{reg.patente}</td>
                        <td className="p-3.5 text-slate-700 font-medium">{reg.depto_destino}</td>
                        <td className="p-3.5 text-slate-600">
                          <div>{reg.nombre_visita || '-'}</div>
                          <div className="text-xs text-slate-400">{reg.rut_visita}</div>
                        </td>
                        <td className="p-3.5 font-medium text-slate-700">{horaIngresoFormatted} hrs</td>
                        <td className="p-3.5 text-slate-700 font-medium">
                          {tarifa.horas}h {tarifa.minutos}m
                        </td>
                        <td className="p-3.5 font-semibold text-slate-800">
                          ${estaPagado ? reg.monto_pagado.toLocaleString('es-CL') : tarifa.monto.toLocaleString('es-CL')}
                        </td>
                        <td className="p-3.5">
                          {estaPagado ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800">
                              🟢 PAGADO ({reg.metodo_pago})
                            </span>
                          ) : tarifa.esGratis ? (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                              🟢 GRATIS (0-4h)
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                              🔴 PENDIENTE (❌)
                            </span>
                          )}
                        </td>
                        <td className="p-3.5 text-right space-x-2">
                          {requierePago && (
                            <>
                              <button
                                onClick={() => marcarComoPagado(reg, 'EFECTIVO')}
                                className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs px-2.5 py-1.5 rounded transition-colors font-medium"
                              >
                                Efectivo
                              </button>
                              <button
                                onClick={() => marcarComoPagado(reg, 'TRANSFERENCIA')}
                                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-2.5 py-1.5 rounded transition-colors font-medium"
                              >
                                Transferencia
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => marcarSalida(reg.id)}
                            className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs px-2.5 py-1.5 rounded transition-colors font-medium"
                          >
                            Dar Salida
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tabla de Historial (Vehículos Retirados) */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <h2 className="text-lg font-semibold text-slate-800">📋 Historial / Salidas Registradas</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-600 uppercase">
                  <th className="p-3.5">PATENTE</th>
                  <th className="p-3.5">DEPTO</th>
                  <th className="p-3.5">LLEGADA</th>
                  <th className="p-3.5">SALIDA</th>
                  <th className="p-3.5">PAGADO</th>
                  <th className="p-3.5">MÉTODO</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {historialSalidas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6 text-center text-slate-400">
                      Aún no hay historial de salidas.
                    </td>
                  </tr>
                ) : (
                  historialSalidas.map((reg) => (
                    <tr key={reg.id} className="hover:bg-slate-50">
                      <td className="p-3.5 font-bold text-slate-800">{reg.patente}</td>
                      <td className="p-3.5 text-slate-700">{reg.depto_destino}</td>
                      <td className="p-3.5 text-slate-600">
                        {new Date(reg.fecha_ingreso).toLocaleString('es-CL', {
                          hour: '2-digit',
                          minute: '2-digit',
                          day: '2-digit',
                          month: '2-digit'
                        })}
                      </td>
                      <td className="p-3.5 text-slate-600">
                        {reg.fecha_salida
                          ? new Date(reg.fecha_salida).toLocaleString('es-CL', {
                              hour: '2-digit',
                              minute: '2-digit',
                              day: '2-digit',
                              month: '2-digit'
                            })
                          : '-'}
                      </td>
                      <td className="p-3.5 font-semibold text-emerald-700">
                        ${reg.monto_pagado.toLocaleString('es-CL')}
                      </td>
                      <td className="p-3.5 text-slate-600 font-medium">{reg.metodo_pago || 'GRATIS'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}