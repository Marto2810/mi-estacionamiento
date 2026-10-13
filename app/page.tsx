'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

// Límite total de estacionamientos disponibles
const TOTAL_ESTACIONAMIENTOS = 13;

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

// Cálculo de Tarifa con 15 minutos de gracia
function calcularTarifaActual(fechaIngresoStr: string, fechaSalidaStr?: string | null) {
  if (!fechaIngresoStr) {
    return { monto: 0, horas: 0, minutos: 0, esGratis: true };
  }
  const ingreso = new Date(fechaIngresoStr);
  const limite = fechaSalidaStr ? new Date(fechaSalidaStr) : new Date();
  const diffMilisegundos = Math.max(0, limite.getTime() - ingreso.getTime());
  
  const minutosTotales = Math.floor(diffMilisegundos / (1000 * 60));
  const horasTranscurridas = Math.floor(minutosTotales / 60);
  const minutosTranscurridos = minutosTotales % 60;

  let esGratis = minutosTotales <= 255;
  let monto = 0;

  if (!esGratis) {
    const minutosExtras = minutosTotales - 240;
    const horasExtras = Math.ceil((minutosExtras - 15) / 60);
    
    if (horasExtras > 0) {
      monto = Math.min(horasExtras * 500, 5000);
    } else {
      esGratis = true; 
    }
  }

  return {
    monto,
    horas: horasTranscurridas,
    minutos: minutosTranscurridos,
    esGratis
  };
}

export default function ConsergeriaPage() {
  const [autenticado, setAutenticado] = useState(false);
  const [cargandoAuth, setCargandoAuth] = useState(true);
  
  const [emailInput, setEmailInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [errorAuth, setErrorAuth] = useState('');

  const [registros, setRegistros] = useState<Registro[]>([]);
  const [patente, setPatente] = useState('');
  const [nombre, setNombre] = useState('');
  const [rut, setRut] = useState('');
  
  const [torre, setTorre] = useState('');
  const [deptoNum, setDeptoNum] = useState('');

  const [registroEditando, setRegistroEditando] = useState<Registro | null>(null);
  const [nuevoEstadoPago, setNuevoEstadoPago] = useState<'GRATIS' | 'PENDIENTE' | 'PAGADO'>('PAGADO');
  const [nuevoMetodoPago, setNuevoMetodoPago] = useState('EFECTIVO');
  const [nuevoMontoPagado, setNuevoMontoPagado] = useState(0);

  const [busqueda, setBusqueda] = useState('');
  const [filtroEstado, setFiltroEstado] = useState<'TODOS' | 'GRATIS' | 'PENDIENTE' | 'PAGADO'>('TODOS');
  const [filtroFecha, setFiltroFecha] = useState<string>('');
  const [pestañaActiva, setPestañaActiva] = useState<'ACTIVOS' | 'HISTORIAL'>('ACTIVOS');
  
  const [horaTurnoInicio, setHoraTurnoInicio] = useState('');
  const [turnoInicioISO, setTurnoInicioISO] = useState('');
  
  const [cargando, setCargando] = useState(false);
  const [, setTick] = useState(0);

  // Verificar sesión real con Supabase al cargar la página
  useEffect(() => {
    const verificarSesion = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        setAutenticado(true);
      }
      setCargandoAuth(false);
    };
    
    verificarSesion();

    const horaGuardada = localStorage.getItem('horaTurnoInicio');
    const isoGuardado = localStorage.getItem('turnoInicioISO');
    
    if (horaGuardada && isoGuardado) {
      setHoraTurnoInicio(horaGuardada);
      setTurnoInicioISO(isoGuardado);
    } else {
      const ahora = new Date();
      const horaFormato = ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      const isoFormato = ahora.toISOString();
      
      setHoraTurnoInicio(horaFormato);
      setTurnoInicioISO(isoFormato);
      localStorage.setItem('horaTurnoInicio', horaFormato);
      localStorage.setItem('turnoInicioISO', isoFormato);
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

  // Nuevo sistema de Login con Supabase
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setCargandoAuth(true);
    setErrorAuth('');
    
    const { error } = await supabase.auth.signInWithPassword({
      email: emailInput.trim(),
      password: passwordInput.trim(),
    });

    if (!error) {
      setAutenticado(true);
      setEmailInput('');
      setPasswordInput('');
    } else {
      setErrorAuth('Correo o contraseña incorrectos.');
    }
    setCargandoAuth(false);
  };

  const cerrarSesion = async () => {
    if (confirm('¿Estás seguro de que deseas cerrar sesión / terminar el turno?')) {
      await supabase.auth.signOut();
      setAutenticado(false);
      
      const ahora = new Date();
      const nuevaHora = ahora.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      const nuevoISO = ahora.toISOString();
      
      localStorage.setItem('horaTurnoInicio', nuevaHora);
      localStorage.setItem('turnoInicioISO', nuevoISO);
      
      setHoraTurnoInicio(nuevaHora);
      setTurnoInicioISO(nuevoISO);
    }
  };

  const registrarIngreso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!patente.trim() || !torre || !deptoNum.trim()) {
      alert('Selecciona la Torre e ingresa la Patente y Departamento.');
      return;
    }

    const deptoLimpio = deptoNum.trim();
    if (!/^\d{3}$/.test(deptoLimpio)) {
      alert('El número de departamento debe tener exactamente 3 dígitos (Ej: 101, 804).');
      return;
    }

    const autosActivosCount = registros.filter((r) => r && !r.fecha_salida).length;
    if (autosActivosCount >= TOTAL_ESTACIONAMIENTOS) {
      alert('⚠️ No hay estacionamientos disponibles (Límite de 13 alcanzado).');
      return;
    }

    setCargando(true);
    const deptoCompleto = `${torre} - Depto ${deptoLimpio}`;

    const nuevoRegistro = {
      patente: patente.toUpperCase().replace(/[^A-Z0-9]/g, ''),
      nombre_visita: nombre.trim() || 'Sin Nombre',
      rut_visita: rut.trim() || 'Sin RUT',
      depto_destino: deptoCompleto,
      fecha_ingreso: new Date().toISOString()
    };

    const { error } = await supabase.from('registros_estacionamiento').insert([nuevoRegistro]);

    if (!error) {
      setPatente('');
      setNombre('');
      setRut('');
      setTorre('');
      setDeptoNum('');
      await obtenerRegistros();
    } else {
      alert('Error de Supabase: ' + error.message);
    }
    setCargando(false);
  };

  const marcarComoPagado = async (registro: Registro, metodo: 'EFECTIVO' | 'TRANSFERENCIA') => {
    const tarifa = calcularTarifaActual(registro.fecha_ingreso, registro.fecha_salida);
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

  const guardarEdicionHistorial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!registroEditando) return;

    const { error } = await supabase
      .from('registros_estacionamiento')
      .update({
        estado_pago: nuevoEstadoPago,
        monto_pagado: nuevoEstadoPago === 'PAGADO' ? Number(nuevoMontoPagado) : 0,
        metodo_pago: nuevoEstadoPago === 'PAGADO' ? nuevoMetodoPago : null
      })
      .eq('id', registroEditando.id);

    if (!error) {
      setRegistroEditando(null);
      obtenerRegistros();
    } else {
      alert('Error al actualizar el historial: ' + error.message);
    }
  };

  // Pantalla de carga mientras verifica sesión en Supabase
  if (cargandoAuth && !autenticado) {
    return (
      <div className="min-h-screen bg-[#1a3b8b] flex items-center justify-center p-4">
        <div className="text-white font-bold animate-pulse text-lg">Cargando sistema...</div>
      </div>
    );
  }

  // Nueva pantalla de Login
  if (!autenticado) {
    return (
      <div className="min-h-screen bg-[#1a3b8b] flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md text-center space-y-6">
          <div className="text-5xl">🏢</div>
          <div>
            <h1 className="text-2xl font-black text-slate-800">Acceso a Conserjería</h1>
            <p className="text-sm text-slate-500 mt-1">Ingresa tus credenciales autorizadas</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="email"
              placeholder="Correo electrónico"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="w-full text-center font-bold p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
              required
            />
            
            <input
              type="password"
              placeholder="Contraseña"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              className="w-full text-center tracking-widest text-xl font-bold p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-slate-700"
              required
            />

            {errorAuth && (
              <p className="text-xs text-red-600 font-semibold">{errorAuth}</p>
            )}

            <button
              type="submit"
              disabled={cargandoAuth}
              className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-blue-300 text-white font-extrabold py-3.5 px-4 rounded-xl shadow transition-colors text-base flex justify-center items-center"
            >
              {cargandoAuth ? 'Verificando...' : 'Iniciar Sesión'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const registrosDelTurno = registros.filter((r) => {
    if (!r || !turnoInicioISO) return false;
    const inicioTurnoTime = new Date(turnoInicioISO).getTime();
    const fechaIng = new Date(r.fecha_ingreso).getTime();
    const fechaSal = r.fecha_salida ? new Date(r.fecha_salida).getTime() : 0;
    
    return fechaIng >= inicioTurnoTime || fechaSal >= inicioTurnoTime;
  });

  const totalEfectivo = registrosDelTurno
    .filter((r) => r.estado_pago === 'PAGADO' && r.metodo_pago === 'EFECTIVO')
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalTransferencias = registrosDelTurno
    .filter((r) => r.estado_pago === 'PAGADO' && (r.metodo_pago === 'TRANSFERENCIA' || r.metodo_pago === 'WEBPAY' || r.metodo_pago === 'MERCADO_PAGO'))
    .reduce((acc, r) => acc + (r.monto_pagado || 0), 0);

  const totalRecaudado = totalEfectivo + totalTransferencias;

  const autosActivosCount = registros.filter((r) => r && !r.fecha_salida).length;
  const estacionamientosLibres = Math.max(0, TOTAL_ESTACIONAMIENTOS - autosActivosCount);

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

    const tarifa = calcularTarifaActual(r.fecha_ingreso, r.fecha_salida);
    let estadoReal: 'GRATIS' | 'PENDIENTE' | 'PAGADO' = r.estado_pago || 'GRATIS';
    if (r.estado_pago !== 'PAGADO') {
      estadoReal = tarifa.esGratis ? 'GRATIS' : 'PENDIENTE';
    }

    const coincideEstado = filtroEstado === 'TODOS' || estadoReal === filtroEstado;

    let coincideFecha = true;
    if (pestañaActiva === 'HISTORIAL' && filtroFecha) {
      const fechaComparar = r.fecha_salida ? new Date(r.fecha_salida) : new Date(r.fecha_ingreso);
      const fechaISO = fechaComparar.toISOString().split('T')[0];
      coincideFecha = fechaISO === filtroFecha;
    }

    return coincideBusqueda && coincideEstado && coincideFecha;
  });

  return (
    <div className="min-h-screen bg-[#f1f4f9] p-4 md:p-8 font-sans text-slate-800">
      <div className="max-w-6xl mx-auto space-y-5">
        
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

        <div className={`p-4 rounded-2xl border flex flex-col sm:flex-row justify-between items-center gap-3 shadow-sm ${
          estacionamientosLibres === 0 
            ? 'bg-red-50 border-red-200 text-red-900' 
            : estacionamientosLibres <= 3 
            ? 'bg-amber-50 border-amber-200 text-amber-900' 
            : 'bg-white border-slate-100 text-slate-800'
        }`}>
          <div className="flex items-center gap-3">
            <span className="text-3xl">🅿️</span>
            <div>
              <h2 className="text-sm font-black uppercase tracking-wider">Disponibilidad de Estacionamientos de Visitas</h2>
              <p className="text-xs text-slate-500 mt-0.5">Capacidad total: {TOTAL_ESTACIONAMIENTOS} espacios</p>
            </div>
          </div>
          <div className="flex items-center gap-4 text-center">
            <div className="bg-slate-100 px-3 py-1.5 rounded-xl">
              <span className="text-[10px] font-bold text-slate-500 block">OCUPADOS</span>
              <span className="text-lg font-black text-slate-800">{autosActivosCount}</span>
            </div>
            <div className={`px-4 py-1.5 rounded-xl ${estacionamientosLibres === 0 ? 'bg-red-600 text-white' : 'bg-emerald-100 text-emerald-800'}`}>
              <span className="text-[10px] font-bold block opacity-80">DISPONIBLES</span>
              <span className="text-lg font-black">{estacionamientosLibres} / {TOTAL_ESTACIONAMIENTOS}</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#eefcf5] border border-[#a7f3d0] p-4 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-[#065f46] uppercase tracking-wider flex items-center gap-1">
              💵 TOTAL EFECTIVO TURNO
            </span>
            <p className="text-3xl font-black text-[#047857] mt-1">\${totalEfectivo.toLocaleString('es-CL')}</p>
          </div>

          <div className="bg-[#faeefc] border border-[#f0abfc] p-4 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-[#701a75] uppercase tracking-wider flex items-center gap-1">
              🏛️ TOTAL TRANSFERENCIAS TURNO
            </span>
            <p className="text-3xl font-black text-[#86198f] mt-1">\${totalTransferencias.toLocaleString('es-CL')}</p>
          </div>

          <div className="bg-[#eff6ff] border border-[#bfdbfe] p-4 rounded-2xl shadow-sm">
            <span className="text-xs font-bold text-[#1e40af] uppercase tracking-wider flex items-center gap-1">
              💰 TOTAL RECAUDADO TURNO
            </span>
            <p className="text-3xl font-black text-[#1d4ed8] mt-1">\${totalRecaudado.toLocaleString('es-CL')}</p>
          </div>
        </div>

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

        {pestañaActiva === 'ACTIVOS' && (
          <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-100">
            <h2 className="text-base font-bold text-slate-800 mb-3">Registrar Nuevo Ingreso</h2>
            <form onSubmit={registrarIngreso} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3">
              
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

              <select
                value={torre}
                onChange={(e) => setTorre(e.target.value)}
                className="p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-semibold text-slate-800 bg-white"
                required
              >
                <option value="">-- Seleccionar Torre --</option>
                <option value="Torre 1">Torre 1</option>
                <option value="Torre 2">Torre 2</option>
                <option value="Torre 3">Torre 3</option>
                <option value="Torre 4">Torre 4</option>
                <option value="Torre 5">Torre 5</option>
                <option value="Torre 6">Torre 6</option>
              </select>

              <input
                type="text"
                placeholder={torre ? 'Depto (Ej: 101)' : 'Primero elige Torre'}
                value={deptoNum}
                disabled={!torre}
                maxLength={3}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '');
                  setDeptoNum(val);
                }}
                className="w-full p-3 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm font-semibold text-slate-800 disabled:bg-slate-100 disabled:cursor-not-allowed"
                required
              />

              <button
                type="submit"
                disabled={cargando || estacionamientosLibres === 0}
                className="bg-[#2563eb] hover:bg-[#1d4ed8] disabled:bg-slate-300 text-white font-bold py-3 px-4 rounded-xl shadow transition-colors text-sm cursor-pointer"
              >
                {cargando ? 'Guardando...' : '+ Ingresar'}
              </button>
            </form>
          </div>
        )}

        <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="relative md:col-span-2">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">🔍</span>
              <input
                type="text"
                placeholder="Buscar por patente, torre, depto o nombre..."
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800"
              />
            </div>

            {pestañaActiva === 'HISTORIAL' && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500 whitespace-nowrap">📅 Fecha:</span>
                <input
                  type="date"
                  value={filtroFecha}
                  onChange={(e) => setFiltroFecha(e.target.value)}
                  className="w-full p-2 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 text-sm text-slate-800"
                />
                {filtroFecha && (
                  <button
                    onClick={() => setFiltroFecha('')}
                    className="text-xs bg-slate-200 hover:bg-slate-300 text-slate-600 font-bold px-2.5 py-2 rounded-lg"
                  >
                    Borrar
                  </button>
                )}
              </div>
            )}
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

        <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center">
            <h2 className="text-base font-bold text-slate-800">
              {pestañaActiva === 'ACTIVOS' ? 'Vehículos Estacionados' : 'Historial de Salidas'}
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="p-3.5">Patente / Visita</th>
                  <th className="p-3.5">Ubicación (Torre/Depto)</th>
                  <th className="p-3.5">Fecha y Entrada</th>
                  {pestañaActiva === 'HISTORIAL' && <th className="p-3.5">Hora Salida</th>}
                  <th className="p-3.5">Tiempo Perm.</th>
                  <th className="p-3.5">Monto</th>
                  <th className="p-3.5">Estado Pago</th>
                  <th className="p-3.5 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {registrosFiltrados.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-slate-400 font-medium">
                      No hay registros disponibles.
                    </td>
                  </tr>
                ) : (
                  registrosFiltrados.map((reg) => {
                    const tarifa = calcularTarifaActual(reg.fecha_ingreso, reg.fecha_salida);
                    const estaPagado = reg.estado_pago === 'PAGADO';
                    const requierePago = !tarifa.esGratis && !estaPagado;
                    
                    const fechaObjIngreso = reg.fecha_ingreso ? new Date(reg.fecha_ingreso) : null;
                    const diaMesIngreso = fechaObjIngreso
                      ? fechaObjIngreso.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' })
                      : '--/--';
                    const horaIngreso = fechaObjIngreso
                      ? fechaObjIngreso.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
                      : '--:--';

                    const horaSalida = reg.fecha_salida
                      ? new Date(reg.fecha_salida).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
                      : '--:--';

                    return (
                      <tr key={reg.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="p-3.5">
                          <div className="font-extrabold text-slate-800">{reg.patente}</div>
                          <div className="text-xs text-slate-400">{reg.nombre_visita || reg.rut_visita || '-'}</div>
                        </td>
                        <td className="p-3.5 font-bold text-slate-700">{reg.depto_destino}</td>
                        <td className="p-3.5 text-slate-600 font-medium">
                          <span className="font-bold text-slate-800">{diaMesIngreso}</span> a las {horaIngreso} hrs
                        </td>
                        {pestañaActiva === 'HISTORIAL' && (
                          <td className="p-3.5 text-slate-600 font-medium">
                            {horaSalida} hrs
                          </td>
                        )}
                        <td className="p-3.5 text-slate-600 font-medium">
                          {tarifa.horas}h {tarifa.minutos}m
                        </td>
                        <td className="p-3.5 font-extrabold text-slate-800">
                          \${estaPagado ? (reg.monto_pagado || 0).toLocaleString('es-CL') : tarifa.monto.toLocaleString('es-CL')}
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

                          {pestañaActiva === 'HISTORIAL' && (
                            <button
                              onClick={() => {
                                setRegistroEditando(reg);
                                setNuevoEstadoPago(reg.estado_pago || 'PAGADO');
                                setNuevoMetodoPago(reg.metodo_pago || 'EFECTIVO');
                                setNuevoMontoPagado(reg.monto_pagado || tarifa.monto);
                              }}
                              className="bg-blue-100 hover:bg-blue-200 text-blue-800 text-xs font-bold px-2.5 py-1.5 rounded-lg transition-colors cursor-pointer"
                            >
                              Editar Pago
                            </button>
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

      {registroEditando && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md space-y-4">
            <div className="flex justify-between items-center border-b pb-3">
              <h3 className="font-extrabold text-base text-slate-800">
                Editar Estado de Pago - Patente: {registroEditando.patente}
              </h3>
              <button
                onClick={() => setRegistroEditando(null)}
                className="text-slate-400 hover:text-slate-600 font-bold text-lg"
              >
                ✕
              </button>
            </div>

            <form onSubmit={guardarEdicionHistorial} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-600 mb-1">Estado de Pago</label>
                <select
                  value={nuevoEstadoPago}
                  onChange={(e) => setNuevoEstadoPago(e.target.value as any)}
                  className="w-full p-2.5 border rounded-xl font-bold text-sm bg-white"
                >
                  <option value="PAGADO">PAGADO</option>
                  <option value="PENDIENTE">PENDIENTE</option>
                  <option value="GRATIS">GRATIS</option>
                </select>
              </div>

              {nuevoEstadoPago === 'PAGADO' && (
                <>
                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Método de Pago</label>
                    <select
                      value={nuevoMetodoPago}
                      onChange={(e) => setNuevoMetodoPago(e.target.value)}
                      className="w-full p-2.5 border rounded-xl font-bold text-sm bg-white"
                    >
                      <option value="EFECTIVO">EFECTIVO</option>
                      <option value="TRANSFERENCIA">TRANSFERENCIA</option>
                      <option value="WEBPAY">WEBPAY</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-600 mb-1">Monto Pagado (\$)</label>
                    <input
                      type="number"
                      value={nuevoMontoPagado}
                      onChange={(e) => setNuevoMontoPagado(Number(e.target.value))}
                      className="w-full p-2.5 border rounded-xl font-bold text-sm"
                      required
                    />
                  </div>
                </>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRegistroEditando(null)}
                  className="w-1/2 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold py-2.5 rounded-xl text-sm"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="w-1/2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-2.5 rounded-xl text-sm"
                >
                  Guardar Cambios
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
