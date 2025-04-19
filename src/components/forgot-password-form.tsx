'use client'

import { useState } from 'react'
import { motion, LayoutGroup } from 'framer-motion'
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { HiOutlineMail } from "react-icons/hi";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // إضافة منطق إعادة تعيين كلمة المرور هنا
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-sm flex-col gap-6">
        <Card className="bg-[#0a0a1f]/50 backdrop-blur-lg border border-[#ffffff15] shadow-xl relative overflow-hidden">
          <LayoutGroup>
            <CardHeader className="text-center">
              <motion.div 
                layout
                className="flex flex-col items-center gap-4"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.3 }}
              >
                {/* أيقونة البريد مع الخلفية الدائرية */}
                <div className="p-4 rounded-full bg-primary/10 backdrop-blur-sm scale-90">
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2 }}
                  >
                    <HiOutlineMail 
                      className="text-primary w-12 h-12 drop-shadow-glow " 
                      style={{ filter: "drop-shadow(0 0 8px rgba(105, 208, 255, 0.4))" }}
                    />
                  </motion.div>
                </div>
                
                <CardTitle className="text-xl text-[#E0E7FF]">
                  Reset your password
                </CardTitle>
                <CardDescription className="text-[#8A8FB5]">
                  Enter your email to receive a reset link
                </CardDescription>
              </motion.div>
            </CardHeader>

            <CardContent>
              <form onSubmit={handleSubmit}>
                <div className="grid gap-6">
                  <motion.div 
                    layout
                    className="grid gap-2"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <Label htmlFor="email" className="text-[#E0E7FF]">
                      Email
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="m@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-[#1D2B3A]/30 border-[#3A3A5F] text-[#E0E7FF] focus:border-[#69d0ff]"
                      required
                    />
                  </motion.div>

                  <motion.div 
                    layout
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, delay: 0.1 }}
                  >
                    <Button
                      type="submit"
                      className="w-full bg-gradient-to-r from-[#8A6BFF] to-[#69d0ff] hover:from-[#7554FF] hover:to-[#4DA6FF] text-white"
                    >
                      Send Reset Instructions
                    </Button>
                  </motion.div>
                </div>
              </form>
            </CardContent>
          </LayoutGroup>
        </Card>

        {/* رابط العودة خارج البطاقة */}
        <motion.div
          className="text-center text-sm text-[#8A8FB5]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          Remember your password?{' '}
          <a
            href="#"
            className="text-[#69d0ff] hover:text-[#8A6BFF] underline underline-offset-4"
          >
            Back to Login
          </a>
        </motion.div>
      </div>
    </div>
  )
}