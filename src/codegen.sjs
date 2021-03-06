// Copyright (c) 2014 Quildreen Motta <quildreen@gmail.com>
//
// Permission is hereby granted, free of charge, to any person
// obtaining a copy of this software and associated documentation files
// (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge,
// publish, distribute, sublicense, and/or sell copies of the Software,
// and to permit persons to whom the Software is furnished to do so,
// subject to the following conditions:
//
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

// -- Dependencies -----------------------------------------------------
var extend     = require('xtend');
var esprima    = require('esprima');
var stableSort = require('stable');

// -- Helpers ----------------------------------------------------------

var IMPORT    = 0
var START     = 1
var DELAYED   = 2
var IMPLEMENT = 3
var END       = 4
var EXPORTING = 5


function Context(name) {
  this.id   = 0
  this.name = name
}
Context.prototype.newVar = function() {
  return id(this.name + (++this.id))
}


/**
 * Returns a valid name for JS identifiers.
 *
 * @summary String → String
 */
function sanitiseName(name) {
  return '$' + name.replace(/(\W)/g, function(x) {
                                       return '$' + x.charCodeAt(0) + '_' })
}

function flatten(xs) {
  if (!Array.isArray(xs)) return xs
  return xs.reduce(function(ys, x) {
    return Array.isArray(x)?  ys.concat(x)
    :      /* otherwise */    ys.concat([x])
  }, [])
}

function foldr(f, b, xs, idx) {
  idx = idx || 0
  return xs.length === 0?  b
  :      /* otherwise */   f(xs[0], foldr(f, b, xs.slice(1), idx + 1), idx)
}

function sort(xs) {
  return stableSort(xs.slice(), function(a, b) {
    return (a['x-order'] || 0) - (b['x-order'] || 0)
  })
}

// -- Base node constructors -------------------------------------------
function node(type, body) {
  return extend({ type: type }, body)
}

function isBlock(x) {
  return x.type === 'BlockStatement'
}

function delayed(a) {
  return extend(a, { 'x-order': DELAYED })
}

function emptyExpr() {
  return unary('void', true, lit(0))
}

function atEnd(a) {
  return extend(a, { 'x-order': END })
}

function atImportPhase(a) {
  return extend(a, { 'x-order': IMPORT })
}

function atImplementationPhase(a) {
  return extend(a, { 'x-order': IMPLEMENT })
}

function atExportPhase(a) {
  return extend(a, { 'x-order': EXPORTING })
}

function lit(value) {
  return node('Literal', { value: value })
}

function throwStmt(x) {
  return node('ThrowStatement', { argument: x })
}

function ifStmt(test, consequent, alternate) {
  return node('IfStatement', { test: test
                             , consequent: consequent
                             , alternate: alternate })
}

function binary(op, left, right) {
  return node('BinaryExpression', { operator: op
                                  , left: left
                                  , right: right })
}

function unary(op, prefix, arg) {
  return node('UnaryExpression', { operator: op
                                 , argument: arg })
}

function eq(a, b){ return binary('===', a, b) }

function not(e){ return unary('!', true, e) }

function like(a, b){ return binary('==', a, b) }

function expr(body) {
  return node('ExpressionStatement', { expression: body })
}

function block(body) {
  return node('BlockStatement', { body: flatten(body) })
}

function ret(value) {
  return node('ReturnStatement', { argument: value })
}

function fn(id, params, body) {
  return node( 'FunctionExpression'
             , { id: id
               , params: params
               , body: block(body)
               , expression: false
               , generator: false })
}

function smember(object, property) {
  return node( 'MemberExpression'
             , { object: object
               , property: property
               , computed: false })
}

function method(object, method, args) {
  return call(member(object, method), args)
}

function array(xs) {
  return node('ArrayExpression', { elements: xs })
}

function obj(xs) {
  return node( 'ObjectExpression'
             , { properties: xs.map(function(x) {
                                      return { key: x.key
                                             , value: x.value
                                             , kind: 'init' }})})
}

function varsDecl(xs) {
  return node( 'VariableDeclaration'
             , { kind: 'var'
               , declarations: xs.map(function(x) {
                                        return node( 'VariableDeclarator'
                                                   , { id  : x[0]
                                                     , init: x[1] })})})
}

function newExpr(callee, args) {
  return node('NewExpression', { callee: callee
                               , arguments: args })
}

function builtin(name) {
  return smember(id("$$Purr"), id(name))
}

function set(what, value) {
  return node('AssignmentExpression', { operator: '='
                                      , left: what
                                      , right: value })
}

function thisExpr() {
  return node('ThisExpression')
}

function prog(body) {
  return node('Program', { body: body })
}

function scoped(expr) {
  return call(
    lambda(null, [id("$$scope")], ret(expr)),
    [call(smember(self(), id("$clone")), [])]
  )
}

function using(name, value, body) {
  return expr(call(fn(null, [name], body), [value]))
}

function force(value) {
  return call(value, [])
}

function get(name) {
  return member(self(), name)
}

function thunk(expr) {
  return fn(null, [], [ret(expr)])
}

function isPartial(expr) {
  return expr['x-partial']
}

function rewritePartials(args) {
  var n = 0
  return args.map(function(arg) {
    return isPartial(arg)?  id("$$" + (n++))
    :      /* otherwise */  arg
  })
}

function generatePartialArgs(args) {
  return args.filter(isPartial).map(function(_, i) {
    return id("$$" + i)
  })
}

function lets(name, value) {
  return expr(set(get(name), value))
}

// High-level stuff
exports.number = number;
function number(sign, integer, decimal, expt) {
  var num = lit(Number(String(integer) + '.' + String(decimal) + renderExpt(expt)));
  return sign?    unary(sign, true, num)
  :      /* _ */  num;

  function renderExpt(e) {
    return e == null? ''
    :      /* _ */    'e' + (e[0] || '') + String(e[1])
  }
}

exports.string = string;
function string(text) {
  return lit(String(text))
}

exports.letStmt = letStmt;
function letStmt(name, value) {
  return expr(call(
    smember(self(), id("$add")),
    [name, value]
  ))
}

exports.module = module;
function module(name, args, body, contracts, decos) {
  var ns = lit(name.value.split(':')[0]);

  return expr(set(
    member(smember(id("module"), id("exports")), name),
    compileContract(
      identifier(name.value),
      contracts,
      fn(
        identifier(name.value),
        [id("$$Purr")].concat(args),
        [
          varsDecl([
            [id("$$package"), ns],
            [self(), call(builtin("$makeNamespace"), [id("$$package")])],
          ])
        ].concat(sort(flatten(body)))
         .concat([
           expr(set(
             id("self"), decorateExpr(decos, name, id("self"))
           )),
           ret(smember(self(), id("$exports")))
         ])
      )
    )
  ))
}

exports.ifaceStmt = ifaceStmt;
function ifaceStmt(name, decls) {
  return using(id("$$proto"), newExpr(builtin("$Protocol"), [name, id("$$package")]), [
    letStmt(name, thunk(id("$$proto"))),
    letStmt(
      lit(name.value + "?"),
      fn(
        identifier(name.value + "?"),
        [id("$value")],
        [ret(call(builtin("$hasImplementation"), [id("$$proto"), id("$value")]))]
      )
    ),
    expr(call(
      smember(self(), id("$defProtocol")),
      [id("$$proto")]
    ))
  ].concat(sort(flatten(decls))));
}

exports.ifaceMethDecl = ifaceMethDecl
function ifaceMethDecl(decos, key, args, contracts) {
  args = args.map(λ(x, i) -> id('$$' + i));

  return letStmt(
    key,
    call(
      smember(id("$$proto"), id("$require")),
      [
        key,
        decorateExpr(
          decos,
          key,
        compileContract(
          identifier(key.value),
          contracts,
            lambda(
              identifier(key.value),
              args,
              ret(call(
                member(call(
                  builtin('$getImplementation'),
                  [id("$$proto"), args[0]]
                ), key),
                args
              ))
            )
          )
        )
      ]
    )
  )
}

exports.ifaceMethDef = ifaceMethDef
function ifaceMethDef(key, args, val) {
  return [
    ifaceMethDecl([], key, args),
    expr(call(
      smember(id("$$proto"), id("$addDefault")),
      [ key, val ]
    ))
  ]
}

exports.ifaceNeed = ifaceNeed
function ifaceNeed(base) {
  return atEnd(expr(call(
    smember(id("$$proto"), id("$extend")),
    [ base ]
  )))
}

exports.implStmt = implStmt;
function implStmt(proto, tag, impl) {
  var implementation = makeImpl(impl);
  
  return atImplementationPhase(expr(call(
    smember(self(), id("$implementProtocol")),
    [proto, tag, implementation, lit(true)]
  )));

  function makeImpl(xs) {
    return obj(xs.map(function(x) {
                        return { key: x[0], value: x[1] } }))
  }
}

function hasContracts(xs) {
  return xs.filter(Boolean).length > 0
}

function compileContract(_id, contracts, lambda) {
  contracts = contracts || [[]];
  var pre    = contracts[0];
  var pos    = contracts[1];
  var name   = _id? lit(_id.name) : lit('(anonymous)');
  if (!hasContracts(pre) && !pos)  return lambda;
  
  var args   = pre.map(function(_,i){ return id('$$' + i) });
  var result = call(lambda, args);
  return fn(
    _id,
    args,
    [
      args.map(function(a, i) {
        if (!pre[i])  return null
        else          return expr(call(builtin("$checkContract"), [pre[i], a, name]))
      }).filter(Boolean),
      varsDecl([[id("$$ret"), call(smember(lambda, id("call")), [id("this")].concat(args))]]),
      pos? expr(call(builtin("$checkCoContract"), [pos, id("$$ret"), name])) : null,
      ret(id("$$ret"))
    ].filter(Boolean)
  )
}

exports.lambda = lambda;
function lambda(id, args, expr, contracts) {
  return compileContract(
    id,
    contracts,
    fn(id, args, Array.isArray(expr)? flatten(expr) : [expr])
  )
}

exports.app = app;
function app(ns, name, args) {
  if (args.some(isPartial))
    return fn(
      null,
      generatePartialArgs(args),
      [ret(call(member(ns, name), rewritePartials(args)))]
    );
  else
    return call(member(ns, name), args);
}

exports.call = call;
function call(callee, args) {
  return node('CallExpression', { callee: callee
                                , arguments: args })
}

exports.identifier = identifier;
function identifier(name) {
  return id(sanitiseName(name))
}

exports.exportStmt = exportStmt;
function exportStmt(name, unpack) {
  return atExportPhase(expr(
    call(
      smember(self(), id("$doExport")),
      [name, lit(!!unpack)]
    )
  ))
}

exports.parseExpr = parseExpr;
function parseExpr(js) {
  try {
    var tokens = esprima.parse(js).body;
  } catch(e) {
    throw new SyntaxError("Couldn't parse the expression:\n" + js + "\n\nReason: " + e.message)
  }
  if (tokens.length !== 1 || tokens[0].type !== 'ExpressionStatement')
    throw new SyntaxError('Expected a single expression in:\n' + js);
  return tokens[0].expression
}

exports.program = program;
function program(modules) {
  return prog(modules)
}

exports.rawId = id;
function id(a) {
  return node('Identifier', { name: a })
}

function member(object, property) {
  return node( 'MemberExpression'
             , { object: object
               , property: property
               , computed: true })
}

exports.adtStmt = adtStmt;
function adtStmt(name, cases) {
  return using(id("$$adt"), newExpr(builtin("$ADT"), [name, id("$$package")]), [
    letStmt(name, thunk(id("$$adt"))),
    letStmt(
      lit(name.value + "?"),
      fn(identifier(name.value + "?"), [id("$value")],
         [ret(eq(
           call(builtin("$tag"), [id("$value")]),
           call(builtin("$tag"), [id("$$adt")])))]))
  ].concat(flatten(cases.map(makeCase)))
   .concat([
     expr(call(smember(id("$$adt"), id("$seal")), []))
   ]));

  function makeCase(pair) {
    var type     = pair[0];
    var key      = pair[1];
    var argNames = key.value.split(':').map(lit)
    var args     = pair[2].map(λ(_, i) -> id('$$' + i));
    var contract = pair[3]

    return [
      expr(call(
        smember(id("$$adt"), id("$add")),
        [
          key,
          compileContract(
            identifier(key.value),
            contract,
            fn(
              identifier(key.value), 
              args,
              makeBody(type, argNames, args).concat([
                ret(id("this"))
              ])
            )
          )
        ]
      )),
      letStmt(key, member(id("$$adt"), key))
    ]
  }

  function makeBody(kind, names, args) {
    switch (kind) {
      case 'Val': return [];
      case 'Bin': return [
        expr(set(smember(thisExpr(), id('$$0')), args[0])),
        expr(set(smember(thisExpr(), id('$$1')), args[1]))
      ];
      case 'Un': return [
        expr(set(smember(thisExpr(), id('$$0')), args[0]))
      ]
      case 'Kw': return args.slice(1).map(function(a, i) {
        return expr(set(smember(thisExpr(), id('$$' + (i + 1))), a))
      });
      default: throw new Error('Unknow data constructor kind: ' + kind)
    }
  }
}

// Pattern matching
function withMatch(vals, xs, vars) {
  return call(
    fn(
      null,
      vars,
      Array.isArray(xs)? flatten(xs) : [xs]
    ),
    vals
  )
}
function guardTry(xs) {
  return node('TryStatement',
              { block: block(xs)
              , handler: node('CatchClause',
                             { param: id('$$e')
                             , body: block([
                               ifStmt(
                                 unary('!', true, eq(id('$$e'), lit('$$case-failed'))),
                                 throwStmt(id('$$e'))
                               )
                             ]) })})
}
function failCase() {
  return throwStmt(
    lit('$$case-failed')
  )
}
function whenCase(test, consequent) {
  return ifStmt(test, consequent, failCase())
}
function newCaseVar(oldVar) {
  var num = Number(oldVar.name.match(/(\d*)$/)[1] || '0');
  return id('$$match' + (num + 1))
}


exports.caseStmt = caseStmt
function caseStmt(vs, xs) {
  return withMatch(
    vs,
    flatten(xs).concat([
      throwStmt(newExpr(id('TypeError'), [lit('No cases matched the value.')]))
    ]),
    vs.map(function(_, i) {
      return id("$$match_val" + i)
    })
  )
}

exports.casePatt = casePatt
function casePatt(patts, e) {
  var ctx = new Context("$$match")
  var vars = patts.map(function(){ return ctx.newVar() })

  return guardTry([
    ret(patts.reduceRight(function(res, patt, i) {
      var name = ctx.newVar()
      return withMatch(
        [id("$$match_val" + i)],
        patt(name, res, ctx),
        [name]
      )
    }, e))
  ])
}

exports.caseAny = caseAny
function caseAny() {
  return function(val, e, ctx) {
    return ret(e)
  }
}

exports.caseVal = caseVal
function caseVal(v) {
  return function(val, e, ctx) {
    return whenCase(
      eq(val, v),
      ret(e)
    )
  }
}

exports.caseVar = caseVar
function caseVar(a) {
  return function(val, e, ctx) {
    return [
      varsDecl([[a, val]]),
      ret(e)
    ]
  }
}

exports.caseId = caseId
function caseId(tag) {
  return function(val, e, ctx) {
    return whenCase(
      eq(smember(val, id("$$ctag")), tag),
      ret(e)
    )
  }
}

exports.caseBind = caseBind
function caseBind(id, patt) {
  return function(val, e, ctx) {
    return patt(
      val,
      call(
        fn(
          null,
          [id],
          [ret(e)]
        ), 
        [val]),
      ctx
    )
  }
}

exports.caseUn = caseUn
function caseUn(tag, body) {
  return function(val, e, ctx) {
    var subVar = ctx.newVar()
    return whenCase(
      eq(smember(val, id("$$ctag")), tag),
      ret(withMatch(
        [smember(val, id('$$0'))],
        body(subVar, e, ctx),
        [subVar]
      ))
    )
  }
}

exports.caseBin = caseBin
function caseBin(tag, l, r) {
  return function(val, e, ctx) {
    var lvar = ctx.newVar(), rvar = ctx.newVar()
    return whenCase(
      eq(smember(val, id("$$ctag")), tag),
      ret(withMatch(
        [smember(val, id("$$0"))],
        l(
          lvar,
          withMatch(
            [smember(val, id("$$1"))],
            r(rvar, e, ctx),
            [rvar]
          ),
          ctx
        ),
        [lvar]
      ))
    )
  }
}

exports.caseKw = caseKw
function caseKw(tag, args) {
  var names = tag.value.split(':').slice(0,-1).map(lit);
  return function(val, e, ctx) {
    return whenCase(
      eq(smember(val, id("$$ctag")), tag),
      ret(names.reduceRight(function(res, name, i) {
        var lvar = ctx.newVar();
        return withMatch(
          [smember(val, id('$$' + (i + 1)))],
          args[i](lvar, res, ctx),
          [lvar]
        )
      }, e))
    )
  }
}

exports.bool = bool
function bool(a) {
  return lit(a)
}

exports.decorator = decorator
function decorator(f, name, e) {
  return flatten([e]).concat([
    atEnd(expr(set(
      get(name),
      call(f, [get(name), name, id("$$package")])
    )))
  ])
}

exports.decorateExpr = decorateExpr
function decorateExpr(decos, name, fn) {
  return decos.reduce(function(result, deco) {
    return call(deco, [result, name, id("$$package")])
  }, fn)
}

exports.decl = decl
function decl(id, e) {
  return varsDecl([[id, e]])
}

exports.binding = binding
function binding(vars, e) {
  return call(
    fn(
      null,
      [self()],
      vars.concat([ret(e)])
    ),
    [call(smember(self(), id("$clone")), [])]
  )
}

exports.list = list
function list(xs) {
  return xs.reduceRight(function(result, x) {
    return call(
      member(self(), lit("::")),
      [x, result]
    )
  }, call(member(self(), lit("Nil")), []))
}

exports.ifExpr = ifExpr
function ifExpr(test, consequent, alternate) {
  return node('ConditionalExpression',
              { test: test,
                consequent: consequent,
                alternate: alternate })
}

exports.partial = partial
function partial() {
  return extend(
    fn(null, [id("$$0")], [ret(id("$$0"))]),
    { 'x-partial': true }
  )
}

exports.member = memberExpr;
function memberExpr(obj, name) {
  return call(
    smember(obj, id("$get")),
    [name]
  )
}

exports.apMember = apMemberExpr;
function apMemberExpr(obj, name) {
  return call(
    smember(obj, id("$getApply")),
    [name]
  )
}

exports.retExpr = ret;
exports.cond = cond;
function cond(xs) {
  return xs.map(function(x) {
    return ifStmt(x[0], ret(x[1]))
  })
}

exports.empty = empty
function empty() {
  return []
}

exports.map = map
function map(xs) {
  return call(
    smember(builtin("$ExtRecord"), id("$fromObject")),
    [
      obj(xs.map(function(x) {
        return { key: x[0], value: x[1] }
      }))
    ]
  )
}

exports.importStmt = importStmt
function importStmt(p, kw, name, binds) {
  return atImportPhase(expr(call(
    fn(
      null,
      [id("$$mod")],
      [
        expr(set(id("$$mod"), instantiate(p, kw))),
        binds.map(compileBind),
        ( name?           letStmt(name, thunk(id("$$mod")))
        : !binds.length?  expr(call(
                            smember(self(), id("$doImport")),
                            [id("$$mod")]
                          ))
        : /* otherwise */ [])
      ]
    ),
    [call(builtin("$load"), [p, id("__dirname")])]
  )));

  function compileBind(pair) {
    var from = pair[0], to = pair[1] || pair[0];
    return letStmt(to, call(smember(id("$$mod"), id("$get")), [from]))
  }

  function instantiate(name, kw) {
    var pub  = id("$$Purr");
    var prop = kw? lit(name.value + ':' + kw[0].value) : name;
    return call(member(id("$$mod"), prop), [pub].concat(kw ? kw[1] : []))
  }
}

exports.parseProg = parseProg
function parseProg(js) {
  try {
    return esprima.parse(js).body
  } catch(e) {
    throw new SyntaxError("Couldn't parse the JavaScript program:\n" + js + "\n\nReason: " + e.message)
  }
}

exports.doExpr = doExpr
function doExpr(xs) {
  var last = xs[xs.length - 1];
  var ys = xs.slice(0, -1).reduceRight(function(ret, e) {
      return compile(e[0], e[1], ret)
    }, last[1]);

  return call(fn(
    null,
    [],
    [
      varsDecl([[id("$$doType"), xs[0][1]]]),
      ret(ys)
    ]
  ), []);

  function compile(name, e, result) {
    return call(
      member(self(), lit('chain:')),
      [
        e,
        fn(
          null,
          [name],
          [
            ret(result)
          ]
        )
      ]
    )
  }
}

exports.doRet = doRet
function doRet(x) {
  return call(member(self(), lit('of:')), [id("$$doType"), x])
}

exports.structStmt = structStmt
function structStmt(name, fields) {
  return using(id("$$record"), fn(identifier(name.value), [], []), [
    expr(set(
      smember(id("$$record"), id("$$name")),
      name
    )),
    letStmt(name, thunk(id("$$record"))),
    varsDecl([
      [
        id("$$methods"),
        obj([])
      ],
      [
        id("$$tag"),
        call(builtin("$newTag"), [id("$$record"), id("$$package")])
      ],
      [
        id("$$pred"),
        fn(identifier(name.value + '?'), [id("$$0")], [
          ret(eq(
            call(builtin("$tag"), [id("$$0")]),
            id("$$tag")
          ))
        ])
      ],
    ]),
    letStmt(
      lit(name.value + '?'),
      id("$$pred")
    ),
    expr(set(
      smember(id("$$record"), id("$$tag")),
      id("$$tag")
    )),
    expr(set(
      smember(id("$$record"), id("prototype")),
      call(smember(builtin("$Struct"), id("$clone")), [])
    )),
    expr(set(
      smember(smember(id("$$record"), id("prototype")), id("$$tag")),
      id("$$tag")
    )),
    expr(set(
      smember(id("$$record"), id("$new")),
      fn(
        identifier(name.value + ' new:'),
        [id("$$map")],
        [
          varsDecl([[id("$$this"), newExpr(id("$$record"), [])]])
        ].concat(flatten(fields.map(compileField))).concat([
          ret(id("$$this"))
        ])
      )
    )),
    expr(set(
      smember(smember(id("$$record"), id("prototype")), id("$namespace")),
      set(
        smember(id("$$record"), id("$namespace")),
        fn(
          null,
          [],
          [ret(id("$$methods"))]
        )
      )
    )),
    fields.map(decl)      
  ])

  function decl(field) {
    var fname = field[1];
    var args  = field[2].slice(1).map(function(_, i){ return id('$$' + i) });
    var ctr   = field[3];

    return letStmt(
      fname,
      set(
        member(id("$$methods"), fname),
        compileContract(
          identifier(fname.value),
          [[id('$$pred')].concat(ctr[0].slice(1)), ctr[1]],
          fn(
            identifier(fname.value),
            [id("$$this")].concat(args),
            [
              ret(call(
                member(id("$$this"), lit("_" + fname.value)),
                [id("$$this")].concat(args)
              ))
            ]
          )
        )
      )
    )
  }

  function compileField(field, i) {
    var ftag  = field[0];
    var fname = field[1];
    var _id   = id("$$" + i);

    return [
      varsDecl([[_id, member(id("$$map"), fname)]]),
      ifStmt(
        binary('!==', unary('typeof', true, _id), lit('function')),
        throwStmt(newExpr(id('TypeError'), [lit('Required ' + fname.value + ' field has to be a Function?')]))
      ),
      expr(set(member(id("$$this"), lit('_' + fname.value)), _id))
    ].filter(Boolean)
  }
}

exports.makeStruct = makeStruct
function makeStruct(expr, map) {
  return call(smember(expr, id("$new")), [map])
}

exports.self = self
function self() {
  return id('self')
}

exports.replDecl = replDecl
function replDecl(body) {
  if (!Array.isArray(body)) body = [body]
  return prog(sort(flatten(body)))
}

exports.replExpr = replExpr
function replExpr(e) {
  return expr(e)
}
