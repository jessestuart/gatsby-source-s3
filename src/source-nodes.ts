import { S3 } from 'aws-sdk'
import {
  createRemoteFileNode,
  CreateRemoteFileNodeArgs,
  FileSystemNode,
} from 'gatsby-source-filesystem'
import _ from 'lodash'
import mime from 'mime-types'

import { constructS3UrlForAsset, isImage } from './utils'

// =========================
// Plugin-specific constants.
// =========================
export const S3SourceGatsbyNodeType = 'S3ImageAsset'

// =================
// Type definitions.
// =================
export interface SourceS3Options {
  // Required params.
  accessKeyId: string
  secretAccessKey: string
  bucketName: string
  // Defaults to `${bucketName}.s3.amazonaws.com`, but may be overridden to
  // e.g., support CDN's (such as CloudFront), or any other S3-compliant API
  // (such as DigitalOcean Spaces.)
  domain?: string
  // Defaults to HTTP.
  protocol?: string
}

export const sourceNodes = async (
  { actions, cache, createNodeId, reporter, store },
  {
    accessKeyId,
    bucketName,
    domain = 's3.amazonaws.com',
    protocol = 'http',
    secretAccessKey,
  }: SourceS3Options
): Promise<any> => {
  const { createNode } = actions

  const S3Instance: S3 = new S3({
    accessKeyId,
    secretAccessKey,
    apiVersion: '2006-03-01',
    endpoint: `${protocol}://${domain}`,
    s3ForcePathStyle: true,
    signatureVersion: 'v4',
  })

  const listObjectsResponse: S3.ListObjectsV2Output = await S3Instance.listObjectsV2(
    { Bucket: bucketName }
  ).promise()

  const s3Entities: S3.ObjectList | undefined = _.get(
    listObjectsResponse,
    'Contents'
  )
  if (!s3Entities || _.isEmpty(s3Entities)) {
    return []
  }

  return await Promise.all(
    _.compact(
      s3Entities.map(async (entity: S3.Object) => {
        if (!isImage(entity)) {
          return
        }

        const url: string | undefined = constructS3UrlForAsset({
          bucketName,
          domain,
          key: entity.Key,
          protocol,
        })
        if (!url) {
          return
        }

        try {
          const createRemoteFileNodeArgs: CreateRemoteFileNodeArgs = {
            cache,
            createNode,
            createNodeId,
            reporter,
            store,
            url,
          }
          const fileNode: FileSystemNode = await createRemoteFileNode(
            createRemoteFileNodeArgs
          )
          if (!fileNode) {
            return
          }

          return await createS3ImageAssetNode({
            createNode,
            createNodeId,
            entity,
            fileNode,
            url,
          })
        } catch (err) {
          Promise.reject(`Error creating S3ImageAsset node: ${err}`)
        }
      })
    )
  )
}

export const createS3ImageAssetNode = ({
  createNode,
  createNodeId,
  entity,
  fileNode,
  url,
}: {
  createNode: Function
  createNodeId: (node: any) => string
  entity: S3.Object
  fileNode: FileSystemNode
  url: string
}): Promise<any> => {
  if (!fileNode) {
    return Promise.reject(
      'File node must be defined when invoking `createS3ImageAssetNode`.'
    )
  }

  const {
    absolutePath,
    fileNodeId,
    Key,
    mediaType,
    objectHash,
  } = getEntityNodeFields({ entity, fileNode })

  return createNode({
    ...entity,
    absolutePath,
    ETag: objectHash,
    id: createNodeId(objectHash),
    Key,
    parent: fileNodeId,
    internal: {
      content: url,
      contentDigest: objectHash,
      mediaType,
      type: S3SourceGatsbyNodeType,
    },
  })
}

export const getEntityNodeFields = ({
  entity,
  fileNode,
}: {
  entity: S3.Object
  fileNode: FileSystemNode
}) => {
  const { ETag, Key = '' } = entity
  const mediaType = mime.lookup(Key)
  // Remove obnoxious escaped double quotes in S3 object's ETag. For reference:
  // > The entity tag is a hash of the object. The ETag reflects changes only
  // > to the contents of an object, not its metadata.
  // @see https://docs.aws.amazon.com/AmazonS3/latest/API/RESTCommonResponseHeaders.html
  const objectHash: string = ETag!.replace(/"/g, '')
  const fileNodeId: string = _.get(fileNode, 'id')
  const absolutePath: string = _.get(fileNode, 'absolutePath')
  return {
    absolutePath,
    fileNodeId,
    Key,
    mediaType,
    objectHash,
  }
}

export default sourceNodes
