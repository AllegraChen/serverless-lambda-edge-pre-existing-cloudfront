'use strict'

class ServerlessLambdaEdgePreExistingCloudFront {
  constructor(serverless, options) {
    this.serverless = serverless
    this.options = options || {}
    this.provider = this.serverless.getProvider('aws')
    this.service = this.serverless.service.service
    this.region = this.provider.getRegion()
    this.stage = this.provider.getStage()

    this.hooks = {
      'after:aws:deploy:finalize:cleanup': async () => {
        this.serverless.service.getAllFunctions().forEach(async (functionName) => {
          const functionObj = this.serverless.service.getFunction(functionName)
          if (functionObj.events) {
            functionObj.events.forEach(async (event) => {
              if (event.preExistingCloudFront) {
                const config = await this.provider.request('CloudFront', 'getDistribution', {
                  Id: event.preExistingCloudFront.distributionId
                })

                if (event.preExistingCloudFront.pathPattern === '*') {
                  config.DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations = await this.associateFunction(
                    config.DistributionConfig.DefaultCacheBehavior.LambdaFunctionAssociations,
                    event,
                    functionObj.name
                  )
                } else {
                  config.DistributionConfig.CacheBehaviors = await this.associateNonDefaultCacheBehaviors(
                    config.DistributionConfig.CacheBehaviors,
                    event,
                    functionObj.name
                  )
                }

                this.provider.request('CloudFront', 'updateDistribution', {
                  Id: event.preExistingCloudFront.distributionId,
                  IfMatch: config.ETag,
                  DistributionConfig: config.DistributionConfig
                })
              }
            })
          }
        })
      }
    }
  }

  async associateNonDefaultCacheBehaviors(cacheBehaviors, event, functionName) {
    for (let i = 0; i < cacheBehaviors.Items.length; i++) {
      if (event.preExistingCloudFront.pathPattern === cacheBehaviors.Items[i].PathPattern) {
        cacheBehaviors.Items[i].LambdaFunctionAssociations = await this.associateFunction(
          cacheBehaviors.Items[i].LambdaFunctionAssociations,
          event,
          functionName
        )
      }
    }
    return cacheBehaviors
  }

  async associateFunction(lambdaFunctionAssociations, event, functionName) {
    const originals = lambdaFunctionAssociations.Items.filter(
      (x) => x.EventType !== event.preExistingCloudFront.eventType
    )
    lambdaFunctionAssociations.Items = originals
    lambdaFunctionAssociations.Items.push({
      LambdaFunctionARN: await this.getlatestVersionLambdaArn(functionName),
      IncludeBody: event.preExistingCloudFront.includeBody,
      EventType: event.preExistingCloudFront.eventType
    })
    lambdaFunctionAssociations.Quantity = lambdaFunctionAssociations.Items.length
    return lambdaFunctionAssociations
  }

  async getlatestVersionLambdaArn(functionName, marker) {
    const args = {
      FunctionName: functionName,
      MaxItems: 50
    }

    if (marker) {
      args['Marker'] = marker
    }

    const versions = await this.provider.request('Lambda', 'listVersionsByFunction', args)

    if (versions.NextMarker !== null) {
      return await this.getlatestVersion(functionName, versions.NextMarker)
    }
    let arn
    versions.Versions.forEach(async (functionObj) => {
      arn = functionObj.FunctionArn
    })
    return arn
  }
}

module.exports = ServerlessLambdaEdgePreExistingCloudFront
