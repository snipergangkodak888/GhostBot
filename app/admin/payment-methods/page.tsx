"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Plus, Edit, Trash2, CreditCard } from "lucide-react"

interface PaymentMethod {
  _id: string
  name: string
  type: 'bank' | 'crypto' | 'mobile_money' | 'other'
  details: {
    accountNumber?: string
    accountName?: string
    bankName?: string
    walletAddress?: string
    phoneNumber?: string
    instructions?: string
    [key: string]: any
  }
  isActive: boolean
  createdAt: string
}

export default function PaymentMethodsPage() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([])
  const [loading, setLoading] = useState(true)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingMethod, setEditingMethod] = useState<PaymentMethod | null>(null)
  
  const [formData, setFormData] = useState({
    name: '',
    type: 'bank' as PaymentMethod['type'],
    accountNumber: '',
    accountName: '',
    bankName: '',
    walletAddress: '',
    phoneNumber: '',
    instructions: '',
    isActive: true
  })

  useEffect(() => {
    fetchPaymentMethods()
  }, [])

  const fetchPaymentMethods = async () => {
    try {
      const res = await fetch('/api/admin/payment-methods')
      if (res.ok) {
        const data = await res.json().catch(() => ({}))
        const nextMethods = Array.isArray(data) ? data : Array.isArray(data?.paymentMethods) ? data.paymentMethods : []
        setPaymentMethods(nextMethods)
      }
    } catch (error) {
      console.error('Failed to fetch payment methods:', error)
      toast.error('Failed to load payment methods')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenDialog = (method?: PaymentMethod) => {
    if (method) {
      setEditingMethod(method)
      setFormData({
        name: method.name,
        type: method.type,
        accountNumber: method.details.accountNumber || '',
        accountName: method.details.accountName || '',
        bankName: method.details.bankName || '',
        walletAddress: method.details.walletAddress || '',
        phoneNumber: method.details.phoneNumber || '',
        instructions: method.details.instructions || '',
        isActive: method.isActive
      })
    } else {
      setEditingMethod(null)
      setFormData({
        name: '',
        type: 'bank',
        accountNumber: '',
        accountName: '',
        bankName: '',
        walletAddress: '',
        phoneNumber: '',
        instructions: '',
        isActive: true
      })
    }
    setIsDialogOpen(true)
  }

  const handleSave = async () => {
    try {
      const details: any = { instructions: formData.instructions }
      
      if (formData.type === 'bank') {
        details.accountNumber = formData.accountNumber
        details.accountName = formData.accountName
        details.bankName = formData.bankName
      } else if (formData.type === 'crypto') {
        details.walletAddress = formData.walletAddress
      } else if (formData.type === 'mobile_money') {
        details.phoneNumber = formData.phoneNumber
        details.accountName = formData.accountName
      }

      const body = {
        name: formData.name,
        type: formData.type,
        details,
        isActive: formData.isActive
      }

      const url = editingMethod
        ? `/api/admin/payment-methods/${editingMethod._id}`
        : '/api/admin/payment-methods'
      
      const method = editingMethod ? 'PATCH' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      if (res.ok) {
        toast.success(editingMethod ? 'Payment method updated' : 'Payment method created')
        fetchPaymentMethods()
        setIsDialogOpen(false)
      } else {
        toast.error('Failed to save payment method')
      }
    } catch (error) {
      console.error('Failed to save payment method:', error)
      toast.error('Failed to save payment method')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this payment method?')) return

    try {
      const res = await fetch(`/api/admin/payment-methods/${id}`, {
        method: 'DELETE'
      })

      if (res.ok) {
        toast.success('Payment method deleted')
        fetchPaymentMethods()
      } else {
        toast.error('Failed to delete payment method')
      }
    } catch (error) {
      console.error('Failed to delete payment method:', error)
      toast.error('Failed to delete payment method')
    }
  }

  const getTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      bank: 'Bank Transfer',
      crypto: 'Cryptocurrency',
      mobile_money: 'Mobile Money',
      other: 'Other'
    }
    return labels[type] || type
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-400">Loading...</div>
      </div>
    )
  }

  return (
    <div className="container max-w-6xl py-8">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Payment Methods</h1>
          <p className="text-gray-400 mt-2">Manage available payment methods for subscriptions</p>
        </div>
        <Button onClick={() => handleOpenDialog()} className="bg-green-600 hover:bg-green-700">
          <Plus className="w-4 h-4 mr-2" />
          Add Payment Method
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {paymentMethods.map((method) => (
          <Card key={method._id} className="bg-gray-900 border-gray-800">
            <CardHeader>
              <div className="flex justify-between items-start">
                <div className="flex items-center gap-3">
                  <CreditCard className="w-5 h-5 text-green-500" />
                  <div>
                    <CardTitle className="text-white text-lg">{method.name}</CardTitle>
                    <CardDescription>{getTypeLabel(method.type)}</CardDescription>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleOpenDialog(method)}
                    className="text-green-500 hover:text-blue-300"
                  >
                    <Edit className="w-4 h-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleDelete(method._id)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm">
                {method.details.bankName && (
                  <p className="text-gray-400">
                    <span className="font-medium">Bank:</span> {method.details.bankName}
                  </p>
                )}
                {method.details.accountNumber && (
                  <p className="text-gray-400">
                    <span className="font-medium">Account:</span> {method.details.accountNumber}
                  </p>
                )}
                {method.details.accountName && (
                  <p className="text-gray-400">
                    <span className="font-medium">Name:</span> {method.details.accountName}
                  </p>
                )}
                {method.details.walletAddress && (
                  <p className="text-gray-400 break-all">
                    <span className="font-medium">Wallet:</span> {method.details.walletAddress}
                  </p>
                )}
                {method.details.phoneNumber && (
                  <p className="text-gray-400">
                    <span className="font-medium">Phone:</span> {method.details.phoneNumber}
                  </p>
                )}
                {method.details.instructions && (
                  <p className="text-gray-400 text-xs mt-2">
                    {method.details.instructions}
                  </p>
                )}
                <div className="pt-2">
                  <span
                    className={`inline-block px-2 py-1 rounded text-xs ${
                      method.isActive
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-gray-700 text-gray-400'
                    }`}
                  >
                    {method.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {paymentMethods.length === 0 && (
        <Card className="bg-gray-900 border-gray-800">
          <CardContent className="py-12 text-center">
            <CreditCard className="w-12 h-12 text-gray-600 mx-auto mb-4" />
            <p className="text-gray-400 mb-4">No payment methods configured yet</p>
            <Button onClick={() => handleOpenDialog()} className="bg-green-600 hover:bg-green-700">
              <Plus className="w-4 h-4 mr-2" />
              Add Your First Payment Method
            </Button>
          </CardContent>
        </Card>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="bg-[#121212] border border-white/10 text-white max-w-2xl rounded-2xl">
          <DialogHeader>
            <DialogTitle>
              {editingMethod ? 'Edit Payment Method' : 'Add Payment Method'}
            </DialogTitle>
            <DialogDescription>
              Configure payment details for subscriptions
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Payment Method Name</Label>
                <Input
                  placeholder="e.g., Main Bank Account"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="bg-gray-800 border-gray-700"
                />
              </div>

              <div className="space-y-2">
                <Label>Type</Label>
                <Select
                  value={formData.type}
                  onValueChange={(value: any) => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger className="bg-gray-800 border-gray-700">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                    <SelectItem value="crypto">Cryptocurrency</SelectItem>
                    <SelectItem value="mobile_money">Mobile Money</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {formData.type === 'bank' && (
              <>
                <div className="space-y-2">
                  <Label>Bank Name</Label>
                  <Input
                    placeholder="e.g., Chase Bank"
                    value={formData.bankName}
                    onChange={(e) => setFormData({ ...formData, bankName: e.target.value })}
                    className="bg-gray-800 border-gray-700"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Account Number</Label>
                    <Input
                      placeholder="1234567890"
                      value={formData.accountNumber}
                      onChange={(e) => setFormData({ ...formData, accountNumber: e.target.value })}
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Account Name</Label>
                    <Input
                      placeholder="John Doe"
                      value={formData.accountName}
                      onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                      className="bg-gray-800 border-gray-700"
                    />
                  </div>
                </div>
              </>
            )}

            {formData.type === 'crypto' && (
              <div className="space-y-2">
                <Label>Wallet Address</Label>
                <Input
                  placeholder="0x..."
                  value={formData.walletAddress}
                  onChange={(e) => setFormData({ ...formData, walletAddress: e.target.value })}
                  className="bg-gray-800 border-gray-700"
                />
              </div>
            )}

            {formData.type === 'mobile_money' && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Phone Number</Label>
                  <Input
                    placeholder="+1234567890"
                    value={formData.phoneNumber}
                    onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                    className="bg-gray-800 border-gray-700"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Account Name</Label>
                  <Input
                    placeholder="John Doe"
                    value={formData.accountName}
                    onChange={(e) => setFormData({ ...formData, accountName: e.target.value })}
                    className="bg-gray-800 border-gray-700"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Payment Instructions</Label>
              <Textarea
                placeholder="Additional instructions for users..."
                value={formData.instructions}
                onChange={(e) => setFormData({ ...formData, instructions: e.target.value })}
                className="bg-gray-800 border-gray-700 min-h-[100px]"
              />
            </div>

            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="isActive"
                checked={formData.isActive}
                onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                className="rounded"
              />
              <Label htmlFor="isActive" className="cursor-pointer">
                Active (visible to users)
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all hover:opacity-90" style={{ background: '#146efc', color: '#ffffff' }}>
              {editingMethod ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
