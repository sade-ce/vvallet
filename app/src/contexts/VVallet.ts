import { useMemo } from 'react'
import { AnchorWallet, useAnchorWallet } from '@solana/wallet-adapter-react'
import { Connection, Keypair, PublicKey } from '@solana/web3.js'
import { Provider, Program, web3 } from '@project-serum/anchor'

import { generateAliasKeypair } from 'utils/crypto'
import idl from 'idl/vvallet.json'
import ReadOnlyWallet from './ReadOnlyWallet'
import { IdentityAlias } from 'types/identityAlias'
import { OwnerProof } from 'types/ownerProof'

// VVallet wraps the program connection for interactions with vvallet on chain
export interface VVallet {
  connectedWallet: AnchorWallet
  connection: Connection
  provider: Provider
  programID: PublicKey
  program: Program
}

// used by the API to look up information on a private Solana RPC
export function useReadOnlyVVallet(): VVallet {
  const clusterURL: string = process.env.NEXT_PUBLIC_CLUSTER_URL
    ? process.env.NEXT_PUBLIC_CLUSTER_URL
    : 'http://127.0.0.1:8899' // default to local

  const keypair = Keypair.generate()
  const local = new ReadOnlyWallet(keypair)
  const connection = new Connection(clusterURL)
  const provider = new Provider(connection, local, Provider.defaultOptions())
  const programID = new PublicKey(idl.metadata.address)
  // @ts-ignore
  const program = new Program(idl, programID, provider)

  return { connectedWallet: local, connection, provider, programID, program }
}

// wraps the program and browser wallet connection for convinience
export function useVVallet(): VVallet | undefined {
  const clusterURL: string = process.env.NEXT_PUBLIC_CLUSTER_URL
    ? process.env.NEXT_PUBLIC_CLUSTER_URL
    : 'http://127.0.0.1:8899' // default to local

  const connectedWallet = useAnchorWallet()!
  const connection = new Connection(clusterURL)
  const provider = new Provider(connection, connectedWallet, Provider.defaultOptions())
  const programID = new PublicKey(idl.metadata.address)
  // @ts-ignore
  const program = new Program(idl, programID, provider)

  return useMemo(
    () =>
      connectedWallet
        ? { connectedWallet, connection, provider, programID, program }
        : undefined,
    [connectedWallet],
  )
}

export const registerAccount = async (app: VVallet, alias: string) => {
  if (!app.connectedWallet) {
    console.log('wallet not connected')
    return
  }

  let aliasKeys = generateAliasKeypair(alias)

  await app.program.rpc.register(alias, {
    accounts: {
      identity: aliasKeys.publicKey,
      owner: app.connectedWallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
    },
    signers: [aliasKeys], // wallet is automatically added as a signer
  })
}

const identityOwnerFilter = (owner: string) => ({
  memcmp: {
    offset: 8, // discriminator
    bytes: owner,
  },
})

// fetch identities by the public key that owns them
export const fetchIdentitiesByOwner = async (
  app: VVallet,
  owner: string,
): Promise<IdentityAlias[]> => {
  if (!app.connectedWallet) {
    Promise.reject('no wallet connected')
  }

  let filters = [identityOwnerFilter(owner)]

  const identities = await app.program.account.identity.all(filters)

  const ownerIdentities: IdentityAlias[] = []

  for (let identity of identities) {
    const ownerIdentity: IdentityAlias = {
      owner: identity.account.owner.toBase58(),
      alias: identity.account.alias,
    }
    ownerIdentities.push(ownerIdentity)
  }

  return ownerIdentities
}

export const fetchIdentity = async (
  app: VVallet,
  alias: string,
): Promise<IdentityAlias> => {
  if (!app.connectedWallet) {
    Promise.reject('no wallet connected')
  }

  let keypair = generateAliasKeypair(alias)
  const resp = await app.program.account.identity.fetch(keypair.publicKey)

  const idAlias: IdentityAlias = {
    owner: resp.owner.toBase58(),
    alias: resp.alias,
  }

  return idAlias
}

export const registerProof = async (
  app: VVallet,
  kind: string,
  proof: string,
): Promise<Keypair | undefined> => {
  if (!app.connectedWallet) {
    console.log('wallet not connected')
    return
  }

  // we don't need to regenerate this, so random is fine
  const keypair = web3.Keypair.generate()

  await app.program.rpc.addProof(kind, proof, {
    accounts: {
      proof: keypair.publicKey,
      owner: app.connectedWallet.publicKey,
      systemProgram: web3.SystemProgram.programId,
    },
    signers: [keypair], // wallet (owner) is automatically added as a signer
  })

  return keypair
}

const proofOwnerFilter = (owner: string) => ({
  memcmp: {
    offset: 8, // discriminator
    bytes: owner,
  },
})

export const fetchProofsByOwner = async (
  app: VVallet,
  owner: string,
): Promise<OwnerProof[]> => {
  if (!app.connectedWallet) {
    Promise.reject('no wallet connected')
  }

  let filters = [proofOwnerFilter(owner)]

  const proofs = await app.program.account.proof.all(filters)

  const ownerProofs: OwnerProof[] = []

  for (let proof of proofs) {
    let ownerProof: OwnerProof = {
      id: proof.publicKey.toBase58(),
      owner: proof.account.owner.toBase58(),
      kind: proof.account.kind,
      proof: proof.account.proof,
    }
    ownerProofs.push(ownerProof)
  }

  return ownerProofs
}

// fetchProof by the public key of the proof (not the public key of the account holder)
export const fetchProof = async (
  app: VVallet,
  publicKey: string,
): Promise<OwnerProof> => {
  if (!app.connectedWallet) {
    Promise.reject('no wallet connected')
  }

  const proof = await app.program.account.proof.fetch(publicKey)

  return {
    id: publicKey,
    owner: proof.owner.toBase58(),
    kind: proof.kind,
    proof: proof.proof,
  }
}

// deleteProof by the public key of the proof
export const deleteProof = async (app: VVallet, ownerProof: OwnerProof) => {
  if (!app.connectedWallet) {
    throw new Error('no wallet connected')
  }

  await app.program.rpc.releaseProof({
    accounts: {
      proof: ownerProof.id,
      owner: ownerProof.owner,
    },
  })
}
