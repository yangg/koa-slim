
const path = require('path')
const fs = require('fs')
const {merge} = require('lodash')
const Router = require('koa-router')

const projectDir = path.dirname(require.main.filename)
const appPackage = require(path.join(projectDir, 'package'))
const dependencies = merge(appPackage.dependencies, appPackage.devDependencies)
const configDir = path.join(projectDir, 'config')
const middlewareDir = path.join(projectDir, 'app/middleware')
const pluginDir = path.join(projectDir, 'app/plugins')
const routesDir = path.join(projectDir, 'app/routes')
const controllersDir = path.join(projectDir, 'app/controllers')
const modelsDir = path.join(projectDir, 'app/models')

const extendConfig = (config, name) => {
  const configName = path.join(configDir, name)
  try {
    let currentConfig = require(configName)
    if (typeof currentConfig === 'function') {
      currentConfig = currentConfig(config)
    }
    merge(config, currentConfig)
  } catch (ex) {
    console.warn(ex.message)
  }
}

function initApp(app) {
  let config = {
    proxy: true,
    env: app.env,
    extendConfigs: ['[env]']
  }
  extendConfig(config, 'default')
  config.extendConfigs.forEach(c =>
    extendConfig(config, c.replace('[env]', app.env))
  )

  app.isDev = app.env === 'development'
  app.isProd = app.env === 'production'
  app.keys = config.keys
  app.proxy = config.proxy
  app.config = config

  const extractPlugin = (name, pluginDir) => {
    let pluginInfo = [name, config[name] || null]
    if (!dependencies.hasOwnProperty(pluginInfo[0])) {
      pluginInfo[0] = path.join(pluginDir, pluginInfo[0])
    }
    return pluginInfo
  }

  const initMiddleware = () => {
    config.middleware.forEach(middleware => {
      let [modulePath, options] = extractPlugin(middleware, middlewareDir)
      app.use(require(modulePath)(options, app))
    })
  }

  const initPlugins = () => {
    config.plugins.forEach(plugin => {
      const [modulePath, options] = extractPlugin(plugin, pluginDir)
      require(modulePath)(options, app)
    })
  }

  const initRoutes = () => {
    const router = Router()
    require(routesDir)(router, app)
    router.get('/__reload', reloadConfig)
    app.use(router.routes(), router.allowedMethods())
  }

  const reloadConfig = (ctx) => {
    if(ctx.request.ip === '127.0.0.1') {
      const fileName = app.env + '.js'
      delete require.cache[path.join(configDir, fileName)]
      extendConfig(app.config, fileName)
      ctx.body = 'Reloaded!'
    }
  }

  const models = new Proxy({}, {
    get: function(target, name) {
      if(name in target) {
        return target[name]
      }
      const modelPath = path.join(modelsDir, name + '.js')
      return fs.existsSync(modelPath) ? require(modelPath)(app) : null
    }
  })
  const controllers = new Proxy({}, {
    get: function(target, name) {
      if(name in target) {
        return target[name]
      }
      const controllerPath = path.join(controllersDir, name + '.js')
      const model = models[name]

      return fs.existsSync(controllerPath) ? require(controllerPath)(app, model) : null
    }
  })
  app.getController = (name) => controllers[name]
  app.getModel = (name) => models[name]
  app.model = models
  app.controller = controllers
  initPlugins()
  initMiddleware()
  initRoutes()
}

module.exports = (app) => {

  initApp(app)

  const config = app.config
  const server = app.listen(config.port || process.env.PORT || 3009, config.listenHost || 'localhost', function () {
    const addressInfo = server.address()
    logger.info('%s(%s) listen on http://%s:%s started', app.config.name, app.env, addressInfo.address, addressInfo.port)
  })
}
