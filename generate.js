const fs = require('fs')
const data = require('./steamworks/public/steam/steam_api.json')
const winAlign = require('./steamworks/align-info-windows.json')
const unixAlign = require('./steamworks/align-info-macos.json')
const outFile = 'src/main.zig'
const outFileCpp = 'src/steam.cpp'

const cpp = [
  '// this file is autogenerated by generate.js - https://github.com/menduz/zig-steamworks',
  `#include <cstdio>`,
  `#include <concepts>`,
  `#include <type_traits>`,

  `#import "steam_api.h"`,
  `#import "steam_gameserver.h"`,
  ``,
  `extern "C" void* CustomSteamClientGetter() { return SteamClient(); }`
]

const cpp_last = []

function getStructAlignment(struct, field) {
  const structName = struct.struct;

  const win = winAlign[structName]
  const unix = unixAlign[structName]

  if (!win || !unix) {
    console.error(`!!! Missing struct align ${structName}`)
    return ''
  }

  const winField = win.fields.find(_ => _.field == field.fieldname)
  const unixField = unix.fields.find(_ => _.field == field.fieldname)

  if (!winField || !unixField) {
    console.error(`!!! Missing struct field ${structName}.${JSON.stringify(field.fieldname)}`)
    return '@compileError("Missing struct field alignment")'
  }

  if (winField.align > unixField.align) {
    return `align(StructPlatformPackSize)`
  } else {
    return `align(${winField.align})`
  }
}


// cleanup
{
  data.callback_structs = data.callback_structs.filter($ => {
    if ($.struct == 'PS3TrophiesInstalled_t') return false
    if ($.struct == 'GSStatsUnloaded_t') return false
    return true
  })
}

const out = ['// this file is autogenerated by generate.js - https://github.com/menduz/zig-steamworks']

out.push(`const std = @import("std");`)
out.push(`pub const Server = @import("server.zig");`)
out.push(`const builtin = @import("builtin");`)
out.push(`pub const CGameID = u64;`)
out.push(`const is_windows = builtin.os.tag == .windows;`)
out.push(`pub const StructPlatformPackSize = if (is_windows) 8 else 4;`)
out.push(`pub const StructPackSize = 4;`)
out.push(`pub const CSteamID = u64;`)
out.push(`pub const intptr_t = ?*anyopaque;`)
out.push(`pub const size_t = isize;`)
out.push(`pub const SteamAPIWarningMessageHook_t = ${convertType(`void (*)(int, const char *)`)};`)
out.push(`pub const SteamAPI_CheckCallbackRegistered_t = ${convertType(`void (*)(int)`)};`)
out.push(`pub const SteamDatagramRelayAuthTicket = ?*anyopaque;`)
out.push(`pub const ISteamNetworkingConnectionSignaling = ?*anyopaque;`)
out.push(`pub const ISteamNetworkingSignalingRecvContext = ?*anyopaque;`)

out.push(`

/// SteamAPI_Init must be called before using any other API functions. If it fails, an
/// error message will be output to the debugger (or stderr) with further information.
pub extern fn SteamAPI_Init() callconv(.C) bool;

/// SteamAPI_Shutdown should be called during process shutdown if possible.
pub extern fn SteamAPI_Shutdown() callconv(.C) void;

pub extern fn SteamAPI_GetHSteamPipe() callconv(.C) HSteamPipe;
pub extern fn SteamAPI_GetHSteamUser() callconv(.C) HSteamPipe;
pub extern fn SteamGameServer_GetHSteamPipe() callconv(.C) HSteamPipe;
pub extern fn SteamGameServer_GetHSteamUser() callconv(.C) HSteamPipe;

// SteamAPI_RestartAppIfNecessary ensures that your executable was launched through Steam.
//
// Returns true if the current process should terminate. Steam is now re-launching your application.
//
// Returns false if no action needs to be taken. This means that your executable was started through
// the Steam client, or a steam_appid.txt file is present in your game's directory (for development).
// Your current process should continue if false is returned.
//
// NOTE: If you use the Steam DRM wrapper on your primary executable file, this check is unnecessary
// since the DRM wrapper will ensure that your application was launched properly through Steam.
pub extern fn SteamAPI_RestartAppIfNecessary( unOwnAppID: u32 ) callconv(.C) bool;

// Many Steam API functions allocate a small amount of thread-local memory for parameter storage.
// SteamAPI_ReleaseCurrentThreadMemory() will free API memory associated with the calling thread.
// This function is also called automatically by SteamAPI_RunCallbacks(), so a single-threaded
// program never needs to explicitly call this function.
pub extern fn SteamAPI_ReleaseCurrentThreadMemory() callconv(.C) void;


// crash dump recording functions
pub extern fn SteamAPI_WriteMiniDump( uStructuredExceptionCode: u32, pvExceptionInfo: [*c]const u8, uBuildID: u32 ) callconv(.C) void;
pub extern fn SteamAPI_SetMiniDumpComment( pchMsg: [*c]const u8 ) callconv(.C) void;

//----------------------------------------------------------------------------------------------------------------------------------------------------------//
//	steamclient.dll private wrapper functions
//
//	The following functions are part of abstracting API access to the steamclient.dll, but should only be used in very specific cases
//----------------------------------------------------------------------------------------------------------------------------------------------------------//

/// SteamAPI_IsSteamRunning() returns true if Steam is currently running
pub extern fn SteamAPI_IsSteamRunning() callconv(.C) bool;

/// sets whether or not Steam_RunCallbacks() should do a try {} catch (...) {} around calls to issuing callbacks
/// This is ignored if you are using the manual callback dispatch method
pub extern fn SteamAPI_SetTryCatchCallbacks( bTryCatchCallbacks: bool ) callconv(.C) void;

/// Inform the API that you wish to use manual event dispatch.  This must be called after SteamAPI_Init, but before
/// you use any of the other manual dispatch functions below.
pub extern fn SteamAPI_ManualDispatch_Init() callconv(.C) void;

/// Perform certain periodic actions that need to be performed.
pub extern fn SteamAPI_ManualDispatch_RunFrame(hSteamPipe: HSteamPipe) callconv(.C) void;

/// Internal structure used in manual callback dispatch
pub const CallbackMsg_t = extern struct  {
  /// Specific user to whom this callback applies.
	m_hSteamUser: HSteamUser,
	/// Callback identifier.  (Corresponds to the k_iCallback enum in the callback structure.)
  m_iCallback: c_int,
  /// Points to the callback structure
	m_pubParam: [*c]u8,
  /// Size of the data pointed to by m_pubParam
	m_cubParam: c_uint,

  pub fn data(self: *const @This()) ?CallbackUnion {
    return switch(self.m_iCallback) {
      ${data.callback_structs.map(_ => `${_.callback_id} => .{ .${_.struct.replace(/_t$/, '')} = from_callback(${_.struct}, self) },`).join('\n')}
      else => null,
    };
  }
};

pub const CallbackEnum = enum {
  ${data.callback_structs.map(_ => `${_.struct.replace(/_t$/, '')},`).join('\n')}
};

pub const CallbackUnion = union(CallbackEnum) {
  ${data.callback_structs.map(_ => `${_.struct.replace(/_t$/, '')}: ${_.struct},`).join('\n')} 
};

fn from_callback(comptime T: anytype, callback: *const CallbackMsg_t) T {
  if (comptime builtin.mode == .Debug) {
    return from_slice_debug(T, callback.*.m_pubParam[0..callback.*.m_cubParam]);
  } else {
    return from_slice(T, callback.*.m_pubParam[0..callback.*.m_cubParam]);
  }
}

// this should be the definitive version of the function. that we are going to use after all alignment issues are resolved
pub fn from_slice(comptime T: anytype, slice: []const u8) T {
  const struct_info = @typeInfo(T).@"struct";
  if (struct_info.layout == .@"extern") {
    const max_size = @sizeOf(T);
      if (max_size < slice.len) {
        return @as(*T, @constCast(@ptrCast(@alignCast(slice[0..max_size])))).*;
      } else {
        return @as(*T, @constCast(@ptrCast(@alignCast(slice)))).*;
      }
    }
    @compileLog(T);
    @compileError("Not extern");
  }
  
  pub fn from_slice_debug(comptime T: anytype, slice: []const u8) T {
    var ret: T = std.mem.zeroes(T);
    const retP = &ret;
    
    const struct_info = @typeInfo(T).@"struct";
    if (struct_info.layout == .@"extern") {
      // the following would be ideal, mostly because it performs way fewer branches
      // -> (&ret).* = @as(*T, @ptrCast(@alignCast(slice))).*;
      // but instead, we must specialize this function with an inline for to account for data types
      // smaller than the alignment of the struct, like reading only one byte for a align(4) u8
      inline for (struct_info.fields) |field| {
        if (!field.is_comptime) {
          const start = @offsetOf(T, field.name);
          const end = start + @sizeOf(field.type);
          if (end > slice.len)  if(!@inComptime()) @panic("not enough data") else @compileError("not enough data");
          @memcpy(std.mem.asBytes(&@field(ret, field.name)), slice[start..end]);
        }
      }
      
      if (!@inComptime()) {
        const fast_method_result = from_slice(T, slice);
        const fast_method_fmt = std.fmt.allocPrint(std.heap.c_allocator, "{any}", .{fast_method_result}) catch unreachable;
        const slow_method_fmt = std.fmt.allocPrint(std.heap.c_allocator, "{any}", .{ret}) catch unreachable;
        
        const are_different = !std.mem.eql(u8, fast_method_fmt, slow_method_fmt);
        
        // finally, print a warning if the serialization differs from what we received.
        // it is important not to miss this logs and review each struct's alignment. eventually, all
        // structs will be corrected
        if (are_different or slice.len != @sizeOf(T)) {
           std.debug.print(" 🚨 Final serializations:\\n     struct: {}\\n    message: {}\\n       slow: {any}\\n       fast: {any}\\n", .{
              std.fmt.fmtSliceHexLower(std.mem.asBytes(retP)),
              std.fmt.fmtSliceHexLower(slice),
              ret,
              fast_method_result,
          });
        }
      }
    } else {
      @compileLog(T);
      @compileError("Not extern");
    }
    
  return ret;
}

test {
  @setEvalBranchQuota(1_000_000);
  
  if (builtin.os.tag == .linux and builtin.cpu.arch != .x86_64) {
    // there are no library bindings for linux+arm and that makes the test fail
  } else {
    std.testing.refAllDeclsRecursive(@This());
  }
}

pub const DigitalAnalogAction_t = extern struct {
  actionHandle: InputAnalogActionHandle_t align(1),
  analogActionData: InputAnalogActionData_t align(1),
};

/// Fetch the next pending callback on the given pipe, if any.  If a callback is available, true is returned
/// and the structure is populated.  In this case, you MUST call SteamAPI_ManualDispatch_FreeLastCallback
/// (after dispatching the callback) before calling SteamAPI_ManualDispatch_GetNextCallback again.
pub extern fn SteamAPI_ManualDispatch_GetNextCallback(hSteamPipe: HSteamPipe, pCallbackMsg: [*c]CallbackMsg_t) callconv(.C) bool;

/// You must call this after dispatching the callback, if SteamAPI_ManualDispatch_GetNextCallback returns true.
pub extern fn SteamAPI_ManualDispatch_FreeLastCallback(hSteamPipe: HSteamPipe) callconv(.C) void;

/// Return the call result for the specified call on the specified pipe.  You really should
/// only call this in a handler for SteamAPICallCompleted_t callback.
pub extern fn SteamAPI_ManualDispatch_GetAPICallResult(hSteamPipe: HSteamPipe, hSteamAPICall: SteamAPICall_t, result: [*c]u8, size: u32, iCallbackExpected: i32, pbFailed: *bool) bool;

extern fn CustomSteamClientGetter() callconv(.C) [*c]ISteamClient;
pub fn SteamClient() ISteamClient {
  return ISteamClient{ .ptr = CustomSteamClientGetter() };
}
`)

{
  const deny_list = ['SteamNetworkingFakeIPResult_t']

  cpp_last.push(`extern "C" int steam_callback_size(int cb_id) {`)
  cpp_last.push(`switch(cb_id) {`)
  data.callback_structs.forEach(_ => {
    const comment = deny_list.includes(_.struct) ? '// ' : ''
    cpp_last.push(`  ${comment}case ${_.callback_id}: return sizeof(${_.struct});`)
  })
  cpp_last.push(`  default: return 0;`)
  cpp_last.push(`}`)
  cpp_last.push(`}`)


  cpp_last.push(`extern "C" int steam_callback_size_field(int cb_id, int field) {`)
  cpp_last.push(`switch(cb_id) {`)
  data.callback_structs.forEach(_ => {
    const comment = deny_list.includes(_.struct) ? '// ' : ''
    cpp_last.push(`  ${comment}case ${_.callback_id}: {`)
    cpp_last.push(`  ${comment}  struct ${_.struct}    *p_foo = 0;`)
    cpp_last.push(`  ${comment}  switch(field) {`)
    _.fields.forEach((f, i) => {
      cpp_last.push(`  ${comment}  case ${i}: return sizeof(p_foo->${f.fieldname});`)
    })
    cpp_last.push(`  ${comment}  default:}`)
    cpp_last.push(`  ${comment}  return 0; }`)
  })
  cpp_last.push(`  default: return 0;`)
  cpp_last.push(`}`)
  cpp_last.push(`}`)


  cpp_last.push(`extern "C" int steam_callback_align_field(int cb_id, int field) {`)
  cpp_last.push(`switch(cb_id) {`)
  data.callback_structs.forEach(_ => {
    const comment = deny_list.includes(_.struct) ? '// ' : ''
    cpp_last.push(`  ${comment}case ${_.callback_id}: {`)
    cpp_last.push(`  ${comment}  struct ${_.struct}    *p_foo = 0;`)
    cpp_last.push(`  ${comment}  switch(field) {`)
    _.fields.forEach((f, i) => {
      cpp_last.push(`  ${comment}  case ${i}: return alignof(p_foo->${f.fieldname});`)
    })
    cpp_last.push(`  ${comment}  default: return 0;}`)
    cpp_last.push(`  ${comment}  return 0; }`)
  })
  cpp_last.push(`  default: return 0;`)
  cpp_last.push(`}`)
  cpp_last.push(`}`)

  cpp_last.push(`extern "C" int steam_callback_align(int cb_id) {`)
  cpp_last.push(`switch(cb_id) {`)
  data.callback_structs.forEach(_ => {
    const comment = deny_list.includes(_.struct) ? '// ' : ''
    cpp_last.push(`  ${comment}case ${_.callback_id}: return alignof(${_.struct});`)
  })
  cpp_last.push(`  default: return 0;`)
  cpp_last.push(`}`)
  cpp_last.push(`}`)
}

out.push(`\n// Typedefs`)
data.typedefs.forEach(t => {
  out.push(`pub const ${t.typedef} = ${convertType(t.type)};`)
})

out.push(`\n// Callbacks`)
data.callback_structs.forEach(_ => {
  out.push(`/// callbackId = ${_.callback_id}`)
  printStruct(_)
})

printConsts(data.consts);
function printConsts(list) {
  out.push(`\n// Constants`)
  list.forEach(_ => {
    const val = _.constval === '0xffffffffffffffffull' ? '0xffffffffffffffff' : _.constval

    if (_.constname == 'HSERVERQUERY_INVALID')
      return out.push(`pub const ${_.constname} = ${val}; `)

    switch (_.constname) {
      case 'k_SteamDatagramPOPID_dev':
      case 'k_SteamItemInstanceIDInvalid':
        return out.push(`// TODO: fix the next line declaration\n// pub const ${_.constname}: ${convertType(_.consttype)} = ${_.constval};`)
    }


    return out.push(`pub const ${_.constname}: ${convertType(_.consttype)} = ${val}; `)
  })
}

function getDefaultValue(typeName, internalType) {
  const enums = [...data.enums, ...(internalType?.enums ?? [])]
  const isEnum = enums.find($ => $.enumname == typeName)
  if (isEnum) {
    const zero = isEnum.values.find($ => parseInt($.value) === 0)
    if (zero) {
      return `${typeName}.${zero.name}`
    }
  }

  switch (typeName) {
    case 'bool': return false
    case 'u8':
    case 'u8':
    case 'i8':
    case 'i16':
    case 'u16':
    case 'i32':
    case 'u32':
    case 'i64':
    case 'u64':
    case 'f32':
    case 'f64':
    case 'isize':
    case 'usize':
    case 'c_uint':
    case 'c_int':
      return '0'
    case '?*anyopaque':
    case '?*const anyopaque':
    case '[*c]u8':
    case '[*c]const u8':
    case '[*c][*c]const u8':
    case '*const anyopaque':
      return 'null'
  }

  const isTypedef = data.typedefs.find($ => $.typedef == typeName)

  if (isTypedef) {
    return getDefaultValue(convertType(isTypedef.type), internalType)
  }
}

function printEnums(enums) {
  enums.length && out.push(`\n// Enums`)
  enums.forEach(_ => {
    const typename = `${_.enumname}`
    out.push(`\npub const ${typename} = enum(c_int) {`)

    _.values.forEach($ => {
      const totalValues = _.values.filter(item => item.value == $.value)
      const isFirst = totalValues.length == 1 || totalValues[0].name == $.name

      if (isFirst)
        out.push(`${$.name} = ${$.value},`)

    })

    out.push(`_,`)

    out.push(`};`)
  })
}

printEnums(data.enums)


function transformParameters(fn) {
  for (const param of fn.params) {

    // detect that a field should be an array
    let prefix = /^(p(v|ch?|sz|ub)?)[A-Z]/g
    const matches_prefix = prefix.exec(param.paramname)

    if (matches_prefix) {
      const paramNameWithoutPrefix = param.paramname.substring(matches_prefix[1].length)
      const countParam = fn.params.find(_ => (
        param.array_count && _.paramname == param.array_count ||
        _.paramname.startsWith('n' + paramNameWithoutPrefix) ||
        _.paramname.startsWith('cub' + paramNameWithoutPrefix) ||
        _.paramname.startsWith('cch' + paramNameWithoutPrefix) ||
        _.paramname.startsWith('cbMax' + paramNameWithoutPrefix) ||
        _.paramname.startsWith('cb' + paramNameWithoutPrefix)
      ))

      param.zero_slice = matches_prefix[1].includes('z')

      const is_pointer_to_pointer = param.paramtype.split(/\*/g).length > 2

      if (!is_pointer_to_pointer) {
        if (countParam && countParam.paramtype.includes('*') == false) {
          param.is_slice = true
          let expr = `${param.paramname}.len`
          if (countParam.paramtype != 'usize') {
            countParam.code_replacement = `@intCast(${expr})`
          } else {
            countParam.code_replacement = expr
          }
          countParam.calculated = true;

        } else if (param.zero_slice) {
          param.is_slice = true
        }

        if (param.is_slice) {
        // if (param.paramtype.endsWith('*')) {
          // param.is_slice = true
          param.code_replacement = `${param.paramname}.ptr`
        }

      }
    }
  }
}

/// converts parameters to a zig-friendly representation
function getParamsAdapted(params) {
  return params.filter(_ => !_.calculated).map(p => {
    const n = paramName(p.paramname)
    const t = convertTypeAdapted(p)

    if (t == 'SteamNetworkingErrMsg')
      return `${n}: [*c]u8`

    return `${n}: ${t}`
  })
}

function printStructMethods(structName, data, module) {
  if (data && data.length) {
    out.push(`// methods`)
    out.push(`const Self = @This();`)
    data.forEach(_ => {
      transformParameters(_)

      const originalParams = getParamsAdapted(_.params)

      const [, fnName] = _.methodname_flat.split(structName + '_')

      const self = module ? "*const Self" : "*Self";

      if (fnName && /^[a-z0-9_]+$/i.test(fnName)) {
        out.push(`pub fn ${fnName}(${[`self: ${self}`, ...originalParams].join(', ')}) ${convertType(_.returntype)} {`)

        // out.push(`  std.debug.print("Calling ${_.methodname_flat}\\n", .{});`)


        let ptr = module ? 'self.ptr' : '@as(?*anyopaque, @ptrCast(self))'

        let args = [ptr]

        for (const p of _.params) {
          if (p.code_replacement) {
            args.push(p.code_replacement)
          } else {
            args.push(paramName(p.paramname))
          }
        }

        out.push(` return ${_.methodname_flat}(${args.join(', ')});`)
        out.push(`}\n`)
      }
    })
  }
}

function paramName(p) {
  switch (p) {
    case "type":
      return '_type'
  } return p
}

function getParams(params) {
  return params.map(p => {
    const n = paramName(p.paramname)
    const t = convertType(p.paramtype, true)

    if (t == 'SteamNetworkingErrMsg')
      return `${n}: [*c]u8`

    return `${n}: ${t}`
  })
}

function printFns(structName, data) {
  if (data && data.length) {
    out.push(`\n// static functions`)
    data.forEach(_ => {
      const self = `self: ?*anyopaque`

      const originalParams = getParams(_.params)

      const params = [
        self,
        ...originalParams
      ]

      out.push(`extern fn ${_.methodname_flat}(${params.join(', ')}) callconv(.C) ${convertType(_.returntype, true)};`)
    })
  }
}


function patchType(field) {
  if (field.fieldname.startsWith("m_b")) {
    field.fieldtype = "bool"
    return
  }
  if (field.fieldtype == "uint64") {
    if (/steamid/i.test(field.fieldname)) { return field.fieldtype = "CSteamID" }
    if (/gameid/i.test(field.fieldname)) { return field.fieldtype = "CGameID" }
  }
}

function alignedFieldName(name) {
  switch (name) {
    case 'CSteamID': // u64
    case 'CGameID': // u64
    case 'bool':
    case 'int':
    case 'uint32':
    case 'int32':
    case 'int8':
    case 'uint8':
    case 'uint64':
    case 'int64_t':
    case 'const char *':
    case 'const char **':
    case 'int64':
    case 'float':
    case 'double':
    case 'void *':
    case 'int16':
    case 'uint16':
      return name;
  }

  const isTypedef = data.typedefs.find($ => $.typedef == name)
  if (isTypedef) return name

  if (name.startsWith('E'))
    return name


  if (name.includes('['))
    return name.substring(0, name.indexOf('['))

  if (name.startsWith('void ('))
    return name

  if (/(\s|:)/.test(name)) {
    console.error(name)
    return name
  }
  if (name.includes('::'))
    return name

  return `aligned_${name}`
}

function arrayPartOfField(type) {
  const slice = /\[(\d+)\]/i
  const r = slice.exec(type)
  if (r) {
    return `[${r[1]}]`
  }
  return ''
}

function printStruct(struct) {
  const structName = struct.struct;

  struct.fields.forEach(patchType)

  out.push(`pub const ${structName} = extern struct {`)

  struct.fields.forEach(field => {
    const type = convertType(field.fieldtype)
    const val = getDefaultValue(type, struct)

    const alignment = getStructAlignment(struct, field)
    out.push(`  ${field.fieldname}: ${convertType(field.fieldtype)} ${alignment} ${val !== undefined ? '=' + val : ''},`)
  });

  if (struct.fields.length == 0) {
    out.push(`  padding: u8,`)
  }

  const win = winAlign[structName]
  const unix = unixAlign[structName]

  out.push(`comptime {`)
  let size = win.size
  let alignment = win.align
  if (win.size != unix.size) {
    size = 'size'
    out.push(`  const size = if (is_windows) ${win.size} else ${unix.size};`)
  }
  if (win.align != unix.align) {
    if (win.align == 8 && unix.align == 4) {
      alignment = 'StructPlatformPackSize'
    } else {
      alignment = 'alignment'
      out.push(`  const alignment = if (is_windows) ${win.align} else ${unix.align};`)
    }
  }
  out.push(`  if (@sizeOf(${structName}) != ${size} or @alignOf(${structName}) != ${alignment}) @compileLog("Size or alignment of ${structName} are mismatch.", @sizeOf(${structName}), @alignOf(${structName}));`)
  out.push(`}`)
  struct.consts && printConsts(struct.consts);
  struct.enums && printEnums(struct.enums)

  printStructMethods(structName, struct.methods, false)

  out.push('};')
  printFns(structName, struct.methods)
}

out.push(`\n// Structs`)
data.structs.forEach(printStruct)

out.push(`\n// Interfaces`)

data.interfaces.forEach(_ => {

  _.accessors?.forEach(a => {
    out.push(`extern fn ${a.name_flat}() callconv(.C) [*c]${_.classname};`)

    out.push(`/// ${a.kind}`)
    out.push(`pub fn ${a.name}() ${_.classname} {`)
    out.push(`  return ${_.classname}{ .ptr = ${a.name_flat}() };`)
    out.push(`}`)
  })


  out.push(`\npub const ${_.classname} = extern struct {`)
  out.push(`ptr: ?*anyopaque,`)

  _.enums && printEnums(_.enums)
  printStructMethods(_.classname, _.methods, true)
  out.push('};')
  printFns(_.classname, _.methods)
})

function convertTypeAdapted(param, fn) {
  const t = param.paramtype
  if (t === undefined) return '@compileError("check logs")'

  { // char[123]
    const slice = /([a-z0-9_]+)\s*\[(\d+)\]/i
    const r = slice.exec(t)
    if (r) {
      return `[${r[2]}]${convertType(r[1])}`
    }
  }

  if (data.enums.some(_ => _.enumname === t))
    return `${t}`;

  { // const servernetadr_t *
    const slice = /^const ([0-9a-z_]+)\s*(\*|&)$/i
    const r = slice.exec(t)
    if (r) {
      let new_type = convertType(r[1])
      if (new_type == 'void') new_type = 'u8'
      if (param.is_slice) {
        if (param.zero_slice) {
          return `[:0]const ${new_type}`
        } else {
          return `[]const ${new_type}`
        }
      }
      return `*const ${new_type}`
    }
  }

  { // servernetadr_t *
    const slice = /^([0-9a-z_]+)\s*(\*|&)$/i
    const r = slice.exec(t)
    if (r) {
      let new_type = convertType(r[1])
      if (new_type == 'void') new_type = 'u8'
      if (param.is_slice) {
        if (param.zero_slice) {
          return `[:0] ${new_type}`
        } else {
          return `[] ${new_type}`
        }
      }
      return `* ${new_type}`
    }
  }
  return convertType(param.paramtype);
}


function convertType(t, isFnSignature) {
  if (t === undefined) return 'void!'

  if (t && t.startsWith('void (*)')) {
    const middle = /\(([^\(]*)\)$/.exec(t)
    const types = middle ? middle[1].split(/\s*,\s*/g) : []
    return `?*const fn (${types.map(_ => convertType(_, true)).join(',')}) callconv(.C) void`
  }

  { // char[123]
    const slice = /([a-z0-9_]+)\s*\[(\d+)\]/i
    const r = slice.exec(t)
    if (r) {
      // const size slices are incompatible with callconv(.C), use a regular poinnter instead.
      // the caller must ensure the pointer has the right size
      if (isFnSignature)
        return `[*c]${convertType(r[1])}`

      return `[${r[2]}]${convertType(r[1])}`
    }
  }
  switch (t) {
    case 'char': return 'u8';
    case 'unsigned char': return 'u8';
    case 'signed char': return 'i8';
    case 'short': return 'i16';
    case 'unsigned short': return 'u16';
    case 'int': return 'i32';
    case 'int32_t': return 'i32';
    case 'unsigned int': return 'u32';
    case 'long long': return 'i64';
    case 'int64_t': return 'i64';
    case 'unsigned long long': return 'u64';
    case 'void *': return '[*c]u8';
    case 'const void *': return '[*c]const u8';
    case 'char *': return '[*c]u8'
    case 'float': return 'f32'
    case 'double': return 'f64'
    case 'const char *': return '[*c]const u8'
    case 'const char **': return '[*c][*c]const u8'
    case 'SteamInputActionEvent_t::AnalogAction_t': return 'DigitalAnalogAction_t'
    case 'RequestPlayersForGameResultCallback_t::PlayerAcceptState_t':
      return 'c_int'

    case 'const ScePadTriggerEffectParam *':
      return '*const anyopaque'

    case 'ISteamHTMLSurface::EHTMLMouseButton':
    case 'ISteamHTMLSurface::EHTMLKeyModifiers':
      return 'c_int'
  }

  if (data.enums.some(_ => _.enumname === t))
    return `${t}`;
  { // const servernetadr_t *
    const slice = /^const ([0-9a-z_]+)\s*\*$/i
    const r = slice.exec(t)
    if (r) {
      return `[*c]const ${convertType(r[1])}`
    }
  }
  { // servernetadr_t *const*
    const slice = /([0-9a-z_]+)\s*\*\s?const\s?\*$/i
    const r = slice.exec(t)
    if (r) {
      return `[*c]const [*c] ${convertType(r[1])}`
    }
  }
  { // servernetadr_t **
    const slice = /^([0-9a-z_]+)\s*\*\*$/i
    const r = slice.exec(t)
    if (r) {
      return `[*c][*c] ${convertType(r[1])}`
    }
  }
  { //const servernetadr_t &
    const slice = /^const ([0-9a-z_]+)\s*&$/i
    const r = slice.exec(t)
    if (r) {
      return `[*c]const ${convertType(r[1])}`
    }
  }
  { //servernetadr_t &
    const slice = /^([0-9a-z_]+)\s*&$/i
    const r = slice.exec(t)
    if (r) {
      return `[*c]${convertType(r[1])}`
    }
  }
  { // servernetadr_t *
    const slice = /^([0-9a-z_]+)\s*\*$/i
    const r = slice.exec(t)
    if (r) {
      return `[*c]${convertType(r[1])}`
    }
  }
  return t;
}

fs.writeFileSync(outFile, out.join('\n'))
fs.writeFileSync(outFileCpp, [...cpp, '', ...cpp_last].join('\n'))
