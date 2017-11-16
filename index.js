
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

module.exports = (app) => {
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
    fs.readdirSync(routesDir)
    .forEach(function (file) {
      if (file.charAt(0) === '.' || file.slice(-3) !== '.js') {
        return
      }
      const moduleName = path.basename(file, '.js')
      const subRouter = Router({
        prefix: `/${moduleName === 'home' ? '' : moduleName}`
      })
      const controller = app.getController(moduleName)

      require(path.join(routesDir, file))(subRouter, controller, app)
      router.use(subRouter.routes(), subRouter.allowedMethods())
    })
    app.use(router.routes(), router.allowedMethods())
  }

  const getModel = (name) => {
    const modelPath = path.join(modelsDir, name + '.js')
    return fs.existsSync(modelPath) ? require(modelPath)(app) : null
  }
  const getController = (name) => {
    const controllerPath = path.join(controllersDir, name + '.js')
    const model = getModel(name)

    return fs.existsSync(controllerPath) ? require(controllerPath)(app, model) : null
  }
  app.getController = getController
  app.getModel = getModel
  initPlugins()
  initMiddleware()
  initRoutes()

  const server = app.listen(config.port || process.env.PORT || 3009, config.listenHost || 'localhost', function () {
    const addressInfo = server.address()
    logger.info('%s(%s) listen on http://%s:%s started', app.config.name, app.env, addressInfo.address, addressInfo.port)
  })
}
