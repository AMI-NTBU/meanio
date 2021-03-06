var express = require('express'),
  session = require('express-session'),
  mongoStore = require('connect-mongo')(session),
  redisStore = require('connect-redis')(session),
  cookieParser = require('cookie-parser'),
  expressValidator = require('express-validator'),
  bodyParser = require('body-parser'),
  methodOverride = require('method-override'),
  http = require('http'),
  http2 = require('http2'),
  https = require('https'),
  fs = require('fs'),
  ServerEngine = require('./engine'),
  Grid = require('gridfs-stream'),
  errorHandler = require('errorhandler'),
  passport = require('passport');

var csurf = require('csurf');
var winston = require('winston');
var constants = require('constants');
var path = require('path');

function ExpressEngine(){
  ServerEngine.call(this);
  this.app = null;
  this.db = null;
  this.mean = null;
}
ExpressEngine.prototype = Object.create(ServerEngine,{constructor:{
  value: ExpressEngine,
  configurable: false,
  writable: false,
  enumerable: false
}});
ExpressEngine.prototype.destroy = function(){
  this.mean = null;
  this.db = null;
  this.app = null;
  ServerEngine.prototype.destroy.call(this);
};
ExpressEngine.prototype.name = function(){
  return 'express';
};
ExpressEngine.prototype.initApp = function(){
  var config = this.mean.config.clean;

  // Express/Mongo session storage
  // this.app.use(session({
  //   secret: config && config.sessionSecret,
  //   store: new redisStore({
  //     host: config.redis.host,
  //     port: config.redis.post,
  //     pass: config.redis.dbOptions.pass
  //   }),
  //   resave: true,
  //   saveUninitialized: true
  // }));

  // this.app.use(require('prerender-node'));
  // require(process.cwd() + '/config/express')(this.app, this.db);

  // The cookieParser should be above session
  this.app.use(cookieParser());
  // Request body parsing middleware should be above methodOverride

  this.app.use(expressValidator());
  this.app.use(bodyParser.json({limit: '1mb'}));
  this.app.use(bodyParser.urlencoded({
    extended: true,
    limit: '1mb'
  }));
  // this.app.use(bodyParser({limit: '3mb'}));
  this.app.use(methodOverride());

  var bypassroutes = ['/apis/auth/login']
  var bypass = function(fn, routes){
    return function(req, res, next) {
      console.log(req.url)
      if (routes && routes.length && routes.indexOf(req.url) !== -1) {
        next();
      } else {
        fn(req, res, next);
      }
    }
  };



  // console.log('use');
  this.app.use(passport.initialize());
  this.app.use(passport.session());
  // this.app.usze(bypass(csurf({cookie: true}), bypassroutes));

  this.mean.register('passport',passport);

  return this.app;
};
ExpressEngine.prototype.beginBootstrap = function(meanioinstance, database){

  this.mean = meanioinstance;
  this.db = database.connection;
  var config = meanioinstance.config.clean;
  // Express settings
  var app = express();

  app.useStatic = function(a,b){
    if('undefined' === typeof b){
      this.use(express.static(a));
    }else{
      this.use(a,express.static(b));
    }
  };
  this.app = app;

  // Register app dependency;
  meanioinstance.register('app', this.initApp.bind(this));

  // var gfs = new Grid(this.db.connection.db, this.db.mongo);

  // var options = {
  //   db: config.mongodb.db, 
  //   username: config.mongodb.dbOptions.user,
  //   password: config.mongodb.dbOptions.pass,
  //   collection: 'db_logs'
  // };

  // winston.add(require('winston-mongodb').MongoDB, options);
  require(process.cwd() + '/config/express')(this.app, this.db);
  
  // Listen on http.port (or port as fallback for old configs)

  var httpServer = http.createServer(app);
  meanioinstance.register('http', httpServer);
  httpServer.listen(config.http ? config.http.port : config.port, config.hostname);

  var sslKeyPath = path.join(config.root, config.https.ssl.key)
  var sslCertPath = path.join(config.root, config.https.ssl.cert)
  if (config.https && config.https.port && fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath) ) {
    var httpsOptions = {
      secureProtocol: 'SSLv23_method',
      secureOptions: constants.SSL_OP_NO_SSLv3 | constants.SSL_OP_NO_SSLv2,
      key: fs.readFileSync(sslKeyPath, 'utf8'),
      cert: fs.readFileSync(sslCertPath, 'utf8')
    };

    var http2Server = http2.createServer(httpsOptions, app);
    meanioinstance.register('http2', http2Server);
    http2Server.listen(config.https.port);
    console.log('https server up and running...')
  }

  meanioinstance.name = config.app.name;
  meanioinstance.app = app;
  // meanioinstance.menus = new (meanioinstance.Menus)();
};

function finalRouteHandler(req, res, next) {
  // if (!this.template) return next();
  // this.template(req, res, next);
  return res.status(500).json({error: 'api endpoint does not exist...'})
}

function NotFoundHandler(err, req, res, next) {

  console.log(err)
  // Treat as 404
  if (~err.message.indexOf('not found')) return next();

  // Log it
  console.error(err.stack);

  // Error page
  res.status(500).json({error: 'code 500'})
  // res.status(500).render('500', {
  //   error: err.stack
  // });
}

function FourOFourHandler(req, res) {
  res.status(404).json({error: 'code 404'})
}

ExpressEngine.prototype.endBootstrap = function(callback){

  // We are going to catch everything else here
  this.app.route('*').get(finalRouteHandler.bind(this));

  // Assume "not found" in the error msgs is a 404. this is somewhat
  // silly, but valid, you can do whatever you like, set properties,
  // use instanceof etc.
  this.app.use(NotFoundHandler);

  // Assume 404 since no middleware responded
  this.app.use(FourOFourHandler);

  // Error handler - has to be last
  if (process.env.NODE_ENV === 'development') {
    this.app.use(errorHandler());
  }
  callback(this);
};

module.exports = ExpressEngine;
